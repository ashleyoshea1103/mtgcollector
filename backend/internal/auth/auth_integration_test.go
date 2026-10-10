//go:build integration

package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

const password = "correct horse battery staple"

// newService returns a service on a fresh database, with a clock the test moves.
func newService(t *testing.T) (*Service, *pgxpool.Pool, *time.Time) {
	t.Helper()
	pool := testdb.New(t)
	s := NewService(store.New(pool))
	clock := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	return s, pool, &clock
}

func TestSignupStoresAHashAndStartsASession(t *testing.T) {
	s, pool, clock := newService(t)
	user, sess, err := s.Signup(t.Context(), "  Ann@Example.com ", password)
	if err != nil {
		t.Fatal(err)
	}
	if user.ID == 0 || user.Email != "Ann@Example.com" {
		t.Errorf("user = %+v, want the address as typed, trimmed", user)
	}
	if !sess.ExpiresAt.Equal(clock.Add(IdleTimeout)) {
		t.Errorf("session expires %v, want %v", sess.ExpiresAt, clock.Add(IdleTimeout))
	}

	var hash string
	if err := pool.QueryRow(t.Context(), `SELECT password_hash FROM users WHERE id = $1`, user.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") || strings.Contains(hash, password) {
		t.Errorf("stored password_hash = %q, want an argon2id hash", hash)
	}

	var stored []byte
	var userID int64
	if err := pool.QueryRow(t.Context(), `SELECT token_hash, user_id FROM sessions`).Scan(&stored, &userID); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(sess.Token))
	if !bytes.Equal(stored, want[:]) || userID != user.ID {
		t.Errorf("stored session = %x for user %d, want the token's SHA-256 for %d", stored, userID, user.ID)
	}
}

func TestAnEmailCanOnlyBeUsedOnceWhateverItsCase(t *testing.T) {
	s, _, _ := newService(t)
	if _, _, err := s.Signup(t.Context(), "ann@example.com", password); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Signup(t.Context(), "ANN@example.COM", "another long password"); !errors.Is(err, ErrEmailTaken) {
		t.Errorf("second sign-up = %v, want ErrEmailTaken", err)
	}
}

func TestABadSignupIsRefusedBeforeTheDatabase(t *testing.T) {
	s, pool, _ := newService(t)
	if _, _, err := s.Signup(t.Context(), "ann@example.com", "short"); apperr.KindOf(err) != apperr.Invalid {
		t.Errorf("= %v, want an apperr.Invalid", err)
	}
	var n int
	pool.QueryRow(t.Context(), `SELECT count(*) FROM users`).Scan(&n)
	if n != 0 {
		t.Errorf("%d users were created", n)
	}
}

func TestLogin(t *testing.T) {
	s, _, _ := newService(t)
	created, _, err := s.Signup(t.Context(), "ann@example.com", password)
	if err != nil {
		t.Fatal(err)
	}
	user, sess, err := s.Login(t.Context(), " ANN@example.com", password)
	if err != nil || user != created || sess.Token == "" {
		t.Fatalf("login = %+v, %v; want %+v and a session", user, err, created)
	}
	for name, tc := range map[string]struct{ email, password string }{
		"a wrong password":   {"ann@example.com", "correct horse battery stapler"},
		"another case":       {"ann@example.com", strings.ToUpper(password)},
		"no such account":    {"bob@example.com", password},
		"an empty password":  {"ann@example.com", ""},
		"an absurd password": {"ann@example.com", strings.Repeat("x", 100_000)},
		"an absurd email":    {strings.Repeat("a", 300) + "@example.com", password},
	} {
		if _, _, err := s.Login(t.Context(), tc.email, tc.password); !errors.Is(err, ErrBadCredentials) {
			t.Errorf("%s: login = %v, want ErrBadCredentials", name, err)
		}
	}
}

func TestEachLoginIsANewSession(t *testing.T) {
	s, _, _ := newService(t)
	_, first, _ := s.Signup(t.Context(), "ann@example.com", password)
	_, second, _ := s.Login(t.Context(), "ann@example.com", password)
	if first.Token == second.Token {
		t.Fatal("logging in reused the session")
	}
	for _, sess := range []Session{first, second} {
		if _, _, err := s.Authenticate(t.Context(), sess.Token); err != nil {
			t.Errorf("a session stopped working: %v", err)
		}
	}
}

func TestAStaleHashIsReplacedAtLogin(t *testing.T) {
	s, pool, _ := newService(t)
	user, _, _ := s.Signup(t.Context(), "ann@example.com", password)
	old := params{memory: 8 * 1024, time: 1, threads: 1}
	salt := []byte("0123456789abcdef")
	oldHash := encode(old, salt, derive(old, normalize(password), salt, keyLen))
	if _, err := pool.Exec(t.Context(), `UPDATE users SET password_hash = $1 WHERE id = $2`, oldHash, user.ID); err != nil {
		t.Fatal(err)
	}

	if _, _, err := s.Login(t.Context(), "ann@example.com", password); err != nil {
		t.Fatalf("login with an old-settings hash: %v", err)
	}
	var hash string
	pool.QueryRow(t.Context(), `SELECT password_hash FROM users WHERE id = $1`, user.ID).Scan(&hash)
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("hash after login = %q, want the current settings", hash)
	}
	if _, _, err := s.Login(t.Context(), "ann@example.com", password); err != nil {
		t.Errorf("login with the new hash: %v", err)
	}
}

func TestAMalformedStoredHashIsLoggedAndRefused(t *testing.T) {
	s, pool, _ := newService(t)
	var logs bytes.Buffer
	s.log = slog.New(slog.NewTextHandler(&logs, nil))
	user, _, _ := s.Signup(t.Context(), "ann@example.com", password)
	pool.Exec(t.Context(), `UPDATE users SET password_hash = '$argon2id$v=19$m=1048576,t=2,p=1$AAAA$AAAA' WHERE id = $1`, user.ID)

	if _, _, err := s.Login(t.Context(), "ann@example.com", password); !errors.Is(err, ErrBadCredentials) {
		t.Errorf("= %v, want ErrBadCredentials", err)
	}
	if !strings.Contains(logs.String(), "malformed") {
		t.Errorf("logs = %q, want the malformed hash reported", logs.String())
	}
}

func TestASessionIsRenewedWithUseAtMostOnceADay(t *testing.T) {
	s, _, clock := newService(t)
	_, sess, _ := s.Signup(t.Context(), "ann@example.com", password)
	start := *clock

	*clock = start.Add(23 * time.Hour)
	if _, renewed, err := s.Authenticate(t.Context(), sess.Token); err != nil || renewed != nil {
		t.Errorf("after 23h: renewed %+v, %v; want no renewal yet", renewed, err)
	}
	*clock = start.Add(25 * time.Hour)
	_, renewed, err := s.Authenticate(t.Context(), sess.Token)
	if err != nil || renewed == nil || !renewed.ExpiresAt.Equal(clock.Add(IdleTimeout)) || renewed.Token != sess.Token {
		t.Fatalf("after 25h: renewed %+v, %v; want the same token expiring %v", renewed, err, clock.Add(IdleTimeout))
	}
	*clock = start.Add(26 * time.Hour)
	if _, renewed, _ := s.Authenticate(t.Context(), sess.Token); renewed != nil {
		t.Error("renewed again an hour later")
	}
	// Past its first expiry, the renewal keeps it going (and renews it again).
	*clock = start.Add(IdleTimeout + time.Hour)
	if _, _, err := s.Authenticate(t.Context(), sess.Token); err != nil {
		t.Fatalf("after the first expiry: %v, want the renewed session", err)
	}
	// Unused for the idle timeout after that: gone.
	*clock = clock.Add(IdleTimeout)
	if _, _, err := s.Authenticate(t.Context(), sess.Token); !errors.Is(err, ErrNoSession) {
		t.Errorf("at the renewed expiry: %v, want ErrNoSession", err)
	}
}

func TestASessionEndsAtTheAbsoluteLimitHoweverMuchItIsUsed(t *testing.T) {
	s, _, clock := newService(t)
	_, sess, _ := s.Signup(t.Context(), "ann@example.com", password)
	start := *clock
	for day := 10; day < 90; day += 10 {
		*clock = start.Add(time.Duration(day) * 24 * time.Hour)
		_, renewed, err := s.Authenticate(t.Context(), sess.Token)
		if err != nil {
			t.Fatalf("day %d: %v", day, err)
		}
		if renewed != nil && renewed.ExpiresAt.After(start.Add(AbsoluteTimeout)) {
			t.Errorf("day %d: renewed to %v, past the absolute limit", day, renewed.ExpiresAt)
		}
	}
	*clock = start.Add(AbsoluteTimeout)
	if _, _, err := s.Authenticate(t.Context(), sess.Token); !errors.Is(err, ErrNoSession) {
		t.Errorf("at the absolute limit: %v, want ErrNoSession", err)
	}
}

func TestLogoutEndsOnlyThatSession(t *testing.T) {
	s, _, _ := newService(t)
	_, a, _ := s.Signup(t.Context(), "ann@example.com", password)
	_, b, _ := s.Login(t.Context(), "ann@example.com", password)

	if err := s.Logout(t.Context(), a.Token); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Authenticate(t.Context(), a.Token); !errors.Is(err, ErrNoSession) {
		t.Errorf("logged-out session: %v, want ErrNoSession", err)
	}
	if _, _, err := s.Authenticate(t.Context(), b.Token); err != nil {
		t.Errorf("the other session ended too: %v", err)
	}
	for _, junk := range []string{"", "nonsense", a.Token} {
		if err := s.Logout(t.Context(), junk); err != nil {
			t.Errorf("Logout(%q) = %v, want nothing to do", junk, err)
		}
	}
}

func TestTokensThatArentSessionsAreRefused(t *testing.T) {
	s, _, _ := newService(t)
	_, sess, _ := s.Signup(t.Context(), "ann@example.com", password)
	forged, _, _ := newToken()
	stored := sha256.Sum256([]byte(sess.Token))
	// The real token with its last character changed (to another that's valid there).
	last := "A"
	if strings.HasSuffix(sess.Token, "A") {
		last = "E"
	}
	for _, tok := range []string{"", forged, sess.Token[:42] + last, string(stored[:])} {
		if _, _, err := s.Authenticate(t.Context(), tok); !errors.Is(err, ErrNoSession) {
			t.Errorf("Authenticate(%q) = %v, want ErrNoSession", tok, err)
		}
	}
}

func TestExpiredSessionsAreDeleted(t *testing.T) {
	s, pool, clock := newService(t)
	s.Signup(t.Context(), "ann@example.com", password)
	*clock = clock.Add(IdleTimeout / 2)
	_, recent, _ := s.Login(t.Context(), "ann@example.com", password)
	*clock = clock.Add(IdleTimeout / 2) // the first has just expired

	n, err := s.DeleteExpiredSessions(t.Context())
	if err != nil || n != 1 {
		t.Errorf("deleted %d, %v; want 1", n, err)
	}
	var left int
	pool.QueryRow(t.Context(), `SELECT count(*) FROM sessions`).Scan(&left)
	if left != 1 {
		t.Errorf("%d sessions left, want 1", left)
	}
	if _, _, err := s.Authenticate(t.Context(), recent.Token); err != nil {
		t.Errorf("the unexpired session was deleted: %v", err)
	}
}

func TestDeletingAUserDeletesTheirSessions(t *testing.T) {
	s, pool, _ := newService(t)
	user, sess, _ := s.Signup(t.Context(), "ann@example.com", password)
	if _, err := pool.Exec(t.Context(), `DELETE FROM users WHERE id = $1`, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Authenticate(t.Context(), sess.Token); !errors.Is(err, ErrNoSession) {
		t.Errorf("= %v, want ErrNoSession", err)
	}
}

func TestTheSchemaRefusesBadRows(t *testing.T) {
	_, pool, _ := newService(t)
	for name, sql := range map[string]string{
		"a plaintext password": `INSERT INTO users (email, password_hash) VALUES ('a@example.com', 'hunter2')`,
		"a long email":         `INSERT INTO users (email, password_hash) VALUES (repeat('a', 255), '$argon2id$x')`,
		"a short token hash":   `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\x00', 1, now())`,
	} {
		if _, err := pool.Exec(t.Context(), sql); err == nil {
			t.Errorf("%s was stored", name)
		}
	}
}

// A login for an email with no account still checks the password, against the dummy hash, so
// it takes as long as one with a wrong password and the time doesn't say which accounts exist.
func TestEveryLoginChecksAPassword(t *testing.T) {
	s, _, _ := newService(t)
	s.Signup(t.Context(), "ann@example.com", password)
	var checked []string
	s.verify = func(encoded, pw string) (bool, bool, error) {
		checked = append(checked, encoded)
		return verifyPassword(encoded, pw)
	}
	s.Login(t.Context(), "ann@example.com", "wrong, but long enough")
	s.Login(t.Context(), "nobody@example.com", "wrong, but long enough")
	if len(checked) != 2 || checked[0] == dummyHash() || checked[1] != dummyHash() {
		t.Errorf("checked %d hashes; want ann's, then the dummy for the unknown email", len(checked))
	}
}

// Sign-up creates the account and its session in one statement: if the session can't be
// stored, there's no account either (else the user could never sign up again, nor log in).
func TestAnAccountIsntCreatedWithoutItsSession(t *testing.T) {
	_, pool, _ := newService(t)
	q := store.New(pool)
	now := timestamp(time.Now())
	_, err := q.CreateUserWithSession(t.Context(), store.CreateUserWithSessionParams{
		Email: "ann@example.com", PasswordHash: "$argon2id$x", TokenHash: []byte("too short"), CreatedAt: now, ExpiresAt: now,
	})
	if err == nil {
		t.Fatal("a session with a bad token hash was stored")
	}
	var users int
	pool.QueryRow(t.Context(), `SELECT count(*) FROM users`).Scan(&users)
	if users != 0 {
		t.Errorf("%d users created without their session", users)
	}
}

func TestATakenEmailCreatesNoSession(t *testing.T) {
	s, pool, _ := newService(t)
	s.Signup(t.Context(), "ann@example.com", password)
	s.Signup(t.Context(), "ann@example.com", password)
	var sessions int
	pool.QueryRow(t.Context(), `SELECT count(*) FROM sessions`).Scan(&sessions)
	if sessions != 1 {
		t.Errorf("%d sessions, want only the first sign-up's", sessions)
	}
}

// A session that can't be renewed is still good for this request: it's renewed next time.
func TestAFailedRenewalDoesntFailTheRequest(t *testing.T) {
	s, pool, clock := newService(t)
	var logs bytes.Buffer
	s.log = slog.New(slog.NewTextHandler(&logs, nil))
	user, sess, _ := s.Signup(t.Context(), "ann@example.com", password)
	for _, sql := range []string{
		`CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no updates'; END $$`,
		`CREATE TRIGGER refuse BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION refuse()`,
	} {
		if _, err := pool.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	*clock = clock.Add(2 * renewAfter)
	got, renewed, err := s.Authenticate(t.Context(), sess.Token)
	if err != nil || got != user || renewed != nil {
		t.Errorf("= %+v, renewed %v, %v; want the user, not renewed", got, renewed, err)
	}
	if !strings.Contains(logs.String(), "renew session") {
		t.Errorf("logs = %q, want the failed renewal reported", logs.String())
	}
}

func TestCleanupDeletesExpiredSessionsAndStopsWhenAsked(t *testing.T) {
	s, pool, clock := newService(t)
	s.Signup(t.Context(), "ann@example.com", password)
	*clock = clock.Add(IdleTimeout)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { s.RunCleanup(ctx, time.Hour); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var n int
		pool.QueryRow(t.Context(), `SELECT count(*) FROM sessions`).Scan(&n)
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the expired session wasn't deleted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunCleanup didn't stop when its context ended, which would hang shutdown")
	}
}
