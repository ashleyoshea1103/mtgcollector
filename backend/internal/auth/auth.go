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

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
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

// The most bytes a password may take at login, checked before anything else. Sign-up's limit
// is in characters after normalizing, and no password it accepts goes over this: a character
// takes at most 4 bytes, or a few more when typed as several code points that normalizing
// joins (a letter and its accents, Hangul jamo: 9 bytes for one syllable).
const maxPasswordBytes = 16 * contract.MaxPasswordLength

// How long one call may wait for the database.
const queryTimeout = 5 * time.Second

// How long a call may wait for a turn to hash a password (a variable for tests).
var hashWait = 10 * time.Second

var (
	ErrEmailTaken     = apperr.New(apperr.Conflict, "an account with that email already exists")
	ErrBadCredentials = apperr.New(apperr.Unauthorized, "email or password is incorrect")
	ErrNoSession      = apperr.New(apperr.Unauthorized, "not signed in")
)

// invalid is a sign-up the server won't accept; the message says why, for the user.
func invalid(format string, args ...any) error {
	return apperr.New(apperr.Invalid, format, args...)
}

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
	verify    func(encoded, password string) (match, stale bool, err error) // verifyPassword; tests watch it
}

// NewService returns a Service using the database through q.
func NewService(q *store.Queries) *Service {
	return &Service{q: q, now: time.Now, log: slog.Default(), hashSlots: make(chan struct{}, max(1, runtime.GOMAXPROCS(0))), verify: verifyPassword}
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
	sess, params, err := s.newSession()
	if err != nil {
		return contract.User{}, Session{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	row, err := s.q.CreateUserWithSession(ctx, store.CreateUserWithSessionParams{
		Email: email, PasswordHash: hash, TokenHash: params.TokenHash, CreatedAt: params.CreatedAt, ExpiresAt: params.ExpiresAt,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.User{}, Session{}, ErrEmailTaken
	}
	if err != nil {
		return contract.User{}, Session{}, db.Error(ctx, "create user", err)
	}
	return contract.User{ID: row.ID, Email: row.Email}, sess, nil
}

// Login checks an email and password and starts a session. A wrong email and a wrong password
// look the same, and take about as long, so neither reveals which accounts exist.
func (s *Service) Login(ctx context.Context, email, password string) (contract.User, Session, error) {
	email = strings.TrimSpace(email)
	// No account has such an email (and Postgres would refuse a NUL or invalid UTF-8 in one).
	if len(email) > maxEmailLength || !utf8.ValidString(email) || strings.ContainsRune(email, 0) || len(password) > maxPasswordBytes {
		return contract.User{}, Session{}, ErrBadCredentials
	}
	qctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	row, err := s.q.UserCredentials(qctx, email)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return contract.User{}, Session{}, db.Error(qctx, "find user", err)
	}
	stored := row.PasswordHash
	if !found {
		stored = dummyHash()
	}
	var match, stale bool
	if err := s.withHashSlot(ctx, func() (err error) { match, stale, err = s.verify(stored, password); return }); err != nil {
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
	sess, params, err := s.newSession()
	if err != nil {
		return contract.User{}, Session{}, err
	}
	params.UserID = row.ID
	ctx, cancel = context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	if err := s.q.CreateSession(ctx, params); err != nil {
		return contract.User{}, Session{}, db.Error(ctx, "create session", err)
	}
	return contract.User{ID: row.ID, Email: row.Email}, sess, nil
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
		return db.Error(ctx, "delete session", err)
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
		return contract.User{}, nil, db.Error(ctx, "find session", err)
	}
	user := contract.User{ID: row.ID, Email: row.Email}
	expires := expiry(now, row.CreatedAt.Time)
	// At most once a day; and a session at its absolute limit can't move at all.
	if expires.Sub(row.ExpiresAt.Time) < renewAfter {
		return user, nil, nil
	}
	if err := s.q.SetSessionExpiry(ctx, store.SetSessionExpiryParams{TokenHash: hash, ExpiresAt: timestamp(expires)}); err != nil {
		// The session is still good; renewing it can wait for the next request.
		s.log.WarnContext(ctx, "renew session", "user", user.ID, "error", db.Error(ctx, "renew session", err))
		return user, nil, nil
	}
	return user, &Session{Token: token, ExpiresAt: expires}, nil
}

// DeleteExpiredSessions removes the sessions that can no longer be used, and says how many.
func (s *Service) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.q.DeleteExpiredSessions(ctx, timestamp(s.now()))
	if err != nil {
		return 0, db.Error(ctx, "delete expired sessions", err)
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

// newSession returns a new session for the browser, and the row to store for it (without
// its user).
func (s *Service) newSession() (Session, store.CreateSessionParams, error) {
	token, hash, err := newToken()
	if err != nil {
		return Session{}, store.CreateSessionParams{}, err
	}
	now := s.now()
	expires := expiry(now, now)
	return Session{Token: token, ExpiresAt: expires},
		store.CreateSessionParams{TokenHash: hash, CreatedAt: timestamp(now), ExpiresAt: timestamp(expires)}, nil
}

// withHashSlot runs f once a hashing slot is free. It gives up when ctx ends, or after
// hashWait (as a timeout: the server is too busy).
func (s *Service) withHashSlot(ctx context.Context, f func() error) error {
	wait := time.NewTimer(hashWait)
	defer wait.Stop()
	select {
	case s.hashSlots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	case <-wait.C:
		return fmt.Errorf("wait to hash a password: %w", context.DeadlineExceeded)
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
		return invalid("enter your email address")
	}
	if len(email) > maxEmailLength {
		return invalid("an email address can't be longer than %d characters", maxEmailLength)
	}
	// Only a plain address: no display name ("Ann <ann@example.com>"), comments or quoting.
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || addr.Name != "" || !strings.Contains(email[strings.LastIndexByte(email, '@'):], ".") {
		return invalid("that doesn't look like an email address")
	}
	return nil
}

func checkPassword(password, email string) error {
	n := utf8.RuneCountInString(string(normalize(password)))
	switch {
	case !utf8.ValidString(password):
		return invalid("the password isn't valid text")
	case n < contract.MinPasswordLength:
		return invalid("use a password of at least %d characters; a few words together work well", contract.MinPasswordLength)
	case n > contract.MaxPasswordLength:
		return invalid("a password can't be longer than %d characters", contract.MaxPasswordLength)
	case strings.EqualFold(strings.TrimSpace(password), email):
		return invalid("the password can't be your email address")
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
