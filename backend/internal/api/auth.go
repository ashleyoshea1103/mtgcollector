package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/ratelimit"
)

// Auth answers the account endpoints and says who is signed in. *auth.Service satisfies it.
type Auth interface {
	Signup(ctx context.Context, email, password string) (contract.User, auth.Session, error)
	Login(ctx context.Context, email, password string) (contract.User, auth.Session, error)
	Logout(ctx context.Context, token string) error
	Authenticate(ctx context.Context, token string) (contract.User, *auth.Session, error)
}

// The session cookie. The __Host- prefix makes browsers insist that it's Secure, for the
// whole site (Path=/) and for this host only (no Domain), so a sibling subdomain can't set
// or replace it. Browsers treat http://localhost as secure, so it works in development too.
const sessionCookie = "__Host-session"

// POST /api/auth/signup {email, password}: creates an account and signs it in.
func signup(a Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var c contract.Credentials
		if !decodeJSON(w, r, &c) {
			return
		}
		user, sess, err := a.Signup(r.Context(), c.Email, c.Password)
		if err != nil {
			authError(w, r, err)
			return
		}
		startSession(w, r, a, sess)
		writeJSON(w, http.StatusCreated, user)
	}
}

// POST /api/auth/login {email, password}: signs in.
func login(a Auth, failures *ratelimit.Keyed) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var c contract.Credentials
		if !decodeJSON(w, r, &c) {
			return
		}
		ok, wait, refund := failures.Take(loginKey(c.Email, r.RemoteAddr))
		if !ok {
			tooMany(w, wait)
			return
		}
		user, sess, err := a.Login(r.Context(), c.Email, c.Password)
		if !errors.Is(err, auth.ErrBadCredentials) {
			refund() // only failures count
		}
		if err != nil {
			if errors.Is(err, auth.ErrBadCredentials) {
				slog.InfoContext(r.Context(), "login failed", "client", ratelimit.ClientKey(r.RemoteAddr))
			}
			authError(w, r, err)
			return
		}
		startSession(w, r, a, sess)
		writeJSON(w, http.StatusOK, user)
	}
}

// loginKey is the failed-login limiter's key for logging in to email from remoteAddr's client:
// a hash, so a long email in the request can't make the limiter hold a long key.
func loginKey(email, remoteAddr string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email)) + "\x00" + ratelimit.ClientKey(remoteAddr)))
	return string(sum[:])
}

// POST /api/auth/logout: ends this browser's session. If that fails, the cookie is kept, so
// logging out can be tried again.
func logout(a Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookie); err == nil {
			if err := a.Logout(r.Context(), c.Value); err != nil {
				serverError(w, r, err)
				return
			}
		}
		clearSessionCookie(w)
		w.WriteHeader(http.StatusNoContent)
	}
}

// GET /api/auth/me: who is signed in.
func me(w http.ResponseWriter, r *http.Request, user contract.User) {
	writeJSON(w, http.StatusOK, user)
}

// requireUser runs next with the signed-in user, or answers 401.
func requireUser(a Auth, next func(http.ResponseWriter, *http.Request, contract.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			authError(w, r, auth.ErrNoSession)
			return
		}
		user, renewed, err := a.Authenticate(r.Context(), c.Value)
		if err != nil {
			authError(w, r, err)
			return
		}
		if renewed != nil {
			setSessionCookie(w, *renewed)
		}
		next(w, r, user)
	}
}

// startSession hands the browser its new session, ending the one it had before, if any.
func startSession(w http.ResponseWriter, r *http.Request, a Auth, sess auth.Session) {
	if old, err := r.Cookie(sessionCookie); err == nil && old.Value != sess.Token {
		if err := a.Logout(r.Context(), old.Value); err != nil {
			// It expires on its own; the new session is what matters now.
			slog.WarnContext(r.Context(), "end the previous session", "error", err)
		}
	}
	setSessionCookie(w, sess)
}

func setSessionCookie(w http.ResponseWriter, sess auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sess.Token,
		Path:     "/",
		MaxAge:   max(1, int(time.Until(sess.ExpiresAt).Seconds())),
		Secure:   true,
		HttpOnly: true, // scripts can't read it
		// Sent when following a link here from another site, not with other sites' requests.
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}

// authError answers with the status for an auth error.
func authError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, auth.ErrNoSession) {
		clearSessionCookie(w) // a cookie for a session that's gone: stop sending it
	}
	fail(w, r, err)
}
