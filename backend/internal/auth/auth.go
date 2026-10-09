// Package auth is accounts and sign-in sessions: signing up, logging in and out, and
// finding the user a session cookie belongs to.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// How long a session lasts: it expires after IdleTimeout without use, and after
// AbsoluteTimeout whatever happens. Using a session moves its expiry forward, but only once
// renewAfter has passed since it was last moved, so most requests don't write to the database.
const (
	IdleTimeout     = 30 * 24 * time.Hour
	AbsoluteTimeout = 90 * 24 * time.Hour
	renewAfter      = 24 * time.Hour
)

// The longest an email address can be (RFC 5321's limit on a path).
const maxEmailLength = 254

// How long one call may wait for the database.
const queryTimeout = 5 * time.Second

var (
	ErrEmailTaken     = errors.New("an account with that email already exists")
	ErrBadCredentials = errors.New("email or password is incorrect")
	ErrNoSession      = errors.New("not signed in")
)

// InputError is a sign-up the server won't accept; Reason says why, for the user.
type InputError struct{ Reason string }

func (e *InputError) Error() string { return e.Reason }

// Session is a sign-in to hand to the browser: Token goes in its cookie, which should
// expire at ExpiresAt.
type Session struct {
	Token     string
	ExpiresAt time.Time
}

// Service does the work. Build it with NewService.
type Service struct {
	q   *store.Queries
	now func() time.Time
	log *slog.Logger
	// Hashing takes 19 MiB and tens of milliseconds, so only a few run at once; the rest wait.
	hashSlots chan struct{}
}

// NewService returns a Service using the database through q.
func NewService(q *store.Queries) *Service {
	return &Service{q: q, now: time.Now, log: slog.Default(), hashSlots: make(chan struct{}, max(1, runtime.GOMAXPROCS(0)))}
}

// Signup creates an account and signs it in.
func (s *Service) Signup(ctx context.Context, email, password string) (contract.User, Session, error) {
	email = strings.TrimSpace(email)
	if err := checkEmail(email); err != nil {
		return contract.User{}, Session{}, err
	}
	if err := checkPassword(password, email); err != nil {
		return contract.User{}, Session{}, err
	}
	var hash string
	if err := s.withHashSlot(ctx, func() (err error) { hash, err = hashPassword(password); return }); err != nil {
		return contract.User{}, Session{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	row, err := s.q.CreateUser(ctx, store.CreateUserParams{Email: email, PasswordHash: hash})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.User{}, Session{}, ErrEmailTaken
	}
	if err != nil {
		return contract.User{}, Session{}, dbError(ctx, "create user", err)
	}
	sess, err := s.startSession(ctx, row.ID)
	return contract.User{ID: row.ID, Email: row.Email}, sess, err
}

// Login checks an email and password and starts a session. A wrong email and a wrong password
// look the same, and take about as long, so neither reveals which accounts exist.
func (s *Service) Login(ctx context.Context, email, password string) (contract.User, Session, error) {
	email = strings.TrimSpace(email)
	if len(email) > maxEmailLength || len(password) > 4*contract.MaxPasswordLength {
		return contract.User{}, Session{}, ErrBadCredentials
	}
	qctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	row, err := s.q.UserCredentials(qctx, email)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return contract.User{}, Session{}, dbError(qctx, "find user", err)
	}
	stored := row.PasswordHash
	if !found {
		stored = dummyHash()
	}
	var match, stale bool
	if err := s.withHashSlot(ctx, func() (err error) { match, stale, err = verifyPassword(stored, password); return }); err != nil {
		if errors.Is(err, errMalformedHash) {
			s.log.ErrorContext(ctx, "stored password hash is malformed", "user", row.ID)
			return contract.User{}, Session{}, ErrBadCredentials
		}
		return contract.User{}, Session{}, err
	}
	if !found || !match {
		return contract.User{}, Session{}, ErrBadCredentials
	}
	if stale {
		s.rehash(ctx, row.ID, password)
	}
	ctx, cancel = context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	sess, err := s.startSession(ctx, row.ID)
	return contract.User{ID: row.ID, Email: row.Email}, sess, err
}

// rehash replaces a password hash made with old settings. A failure only means it's tried
// again next time, so it's logged, not returned.
func (s *Service) rehash(ctx context.Context, id int64, password string) {
	var hash string
	err := s.withHashSlot(ctx, func() (err error) { hash, err = hashPassword(password); return })
	if err == nil {
		ctx, cancel := context.WithTimeout(ctx, queryTimeout)
		defer cancel()
		err = s.q.SetPasswordHash(ctx, store.SetPasswordHashParams{ID: id, PasswordHash: hash})
	}
	if err != nil {
		s.log.WarnContext(ctx, "update a stale password hash", "user", id, "error", err)
	}
}

// Logout ends the session with this token, if there is one.
func (s *Service) Logout(ctx context.Context, token string) error {
	hash, ok := hashToken(token)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	if err := s.q.DeleteSession(ctx, hash); err != nil {
		return dbError(ctx, "delete session", err)
	}
	return nil
}

// Authenticate returns the user whose session this token is, or ErrNoSession. When the
// session's expiry has been moved forward, it also returns the session to send back to the
// browser, so the cookie's expiry moves too.
func (s *Service) Authenticate(ctx context.Context, token string) (contract.User, *Session, error) {
	hash, ok := hashToken(token)
	if !ok {
		return contract.User{}, nil, ErrNoSession
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	now := s.now()
	row, err := s.q.SessionUser(ctx, store.SessionUserParams{TokenHash: hash, Now: timestamp(now)})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.User{}, nil, ErrNoSession
	}
	if err != nil {
		return contract.User{}, nil, dbError(ctx, "find session", err)
	}
	user := contract.User{ID: row.ID, Email: row.Email}
	expires := expiry(now, row.CreatedAt.Time)
	// At most once a day; and a session at its absolute limit can't move at all.
	if expires.Sub(row.ExpiresAt.Time) < renewAfter {
		return user, nil, nil
	}
	if err := s.q.SetSessionExpiry(ctx, store.SetSessionExpiryParams{TokenHash: hash, ExpiresAt: timestamp(expires)}); err != nil {
		return contract.User{}, nil, dbError(ctx, "renew session", err)
	}
	return user, &Session{Token: token, ExpiresAt: expires}, nil
}

// DeleteExpiredSessions removes the sessions that can no longer be used, and says how many.
func (s *Service) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.q.DeleteExpiredSessions(ctx, timestamp(s.now()))
	if err != nil {
		return 0, dbError(ctx, "delete expired sessions", err)
	}
	return n, nil
}

// RunCleanup deletes expired sessions every interval until ctx ends.
func (s *Service) RunCleanup(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if n, err := s.DeleteExpiredSessions(ctx); err != nil && ctx.Err() == nil {
			s.log.WarnContext(ctx, "delete expired sessions", "error", err)
		} else if n > 0 {
			s.log.InfoContext(ctx, "deleted expired sessions", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Service) startSession(ctx context.Context, userID int64) (Session, error) {
	token, hash, err := newToken()
	if err != nil {
		return Session{}, err
	}
	now := s.now()
	expires := expiry(now, now)
	err = s.q.CreateSession(ctx, store.CreateSessionParams{
		TokenHash: hash, UserID: userID, CreatedAt: timestamp(now), ExpiresAt: timestamp(expires),
	})
	if err != nil {
		return Session{}, dbError(ctx, "create session", err)
	}
	return Session{Token: token, ExpiresAt: expires}, nil
}

// withHashSlot runs f once a hashing slot is free, or gives up when ctx ends.
func (s *Service) withHashSlot(ctx context.Context, f func() error) error {
	select {
	case s.hashSlots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-s.hashSlots }()
	return f()
}

// expiry is when a session started at created should expire if it's used at now. Times are
// in microseconds, as Postgres stores them.
func expiry(now, created time.Time) time.Time {
	e := now.Add(IdleTimeout)
	if limit := created.Add(AbsoluteTimeout); e.After(limit) {
		e = limit
	}
	return e.Round(0).Truncate(time.Microsecond) // Round(0) drops the monotonic clock reading
}

func timestamp(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// tokenLen is the length of a session token: 32 random bytes in unpadded base64url.
var tokenLen = base64.RawURLEncoding.EncodedLen(32)

// newToken returns a new session token and the hash to store for it.
func newToken() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	hash, _ := hashToken(token)
	return token, hash, nil
}

// hashToken returns what's stored for a token, or false if it can't be one of ours.
func hashToken(token string) ([]byte, bool) {
	if len(token) != tokenLen {
		return nil, false
	}
	if _, err := base64.RawURLEncoding.Strict().DecodeString(token); err != nil {
		return nil, false
	}
	sum := sha256.Sum256([]byte(token))
	return sum[:], true
}

func checkEmail(email string) error {
	if email == "" {
		return &InputError{"enter your email address"}
	}
	if len(email) > maxEmailLength {
		return &InputError{fmt.Sprintf("an email address can't be longer than %d characters", maxEmailLength)}
	}
	// Only a plain address: no display name ("Ann <ann@example.com>"), comments or quoting.
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || addr.Name != "" || !strings.Contains(email[strings.LastIndexByte(email, '@'):], ".") {
		return &InputError{"that doesn't look like an email address"}
	}
	return nil
}

func checkPassword(password, email string) error {
	n := utf8.RuneCountInString(string(normalize(password)))
	switch {
	case !utf8.ValidString(password):
		return &InputError{"the password isn't valid text"}
	case n < contract.MinPasswordLength:
		return &InputError{fmt.Sprintf("use a password of at least %d characters; a few words together work well", contract.MinPasswordLength)}
	case n > contract.MaxPasswordLength:
		return &InputError{fmt.Sprintf("a password can't be longer than %d characters", contract.MaxPasswordLength)}
	case strings.EqualFold(strings.TrimSpace(password), email):
		return &InputError{"the password can't be your email address"}
	}
	return nil
}

// dummyHash is a hash of nothing anyone can type, with the current settings: a login for an
// email with no account checks the password against it, so it takes as long as a real one.
var dummyHash = sync.OnceValue(func() string {
	salt := make([]byte, saltLen)
	key := make([]byte, keyLen) // all zeros: no password derives it
	return encode(current, salt, key)
})

// dbError says what failed, and why: when ctx has ended, Postgres's own error (a cancelled
// statement) doesn't say whether it timed out or the caller went away, so ctx's reason is
// added for callers to test with errors.Is.
func dbError(ctx context.Context, what string, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil && !errors.Is(err, ctxErr) {
		return fmt.Errorf("%s: %w (%w)", what, err, ctxErr)
	}
	return fmt.Errorf("%s: %w", what, err)
}
