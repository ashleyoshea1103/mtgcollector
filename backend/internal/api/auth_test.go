package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/ratelimit"
)

const (
	testToken    = "tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	testPassword = "correct horse battery staple"
)

var testUser = contract.User{ID: 7, Email: "ann@example.com"}

// fakeAuth records what the handlers asked for and answers with err, if set.
type fakeAuth struct {
	err       error
	email, pw string
	loggedOut []string
	token     string // what Authenticate was given
	renewed   *auth.Session
	logoutErr error
	calls     []string
}

func (f *fakeAuth) session() auth.Session {
	return auth.Session{Token: testToken, ExpiresAt: time.Now().Add(auth.IdleTimeout)}
}

func (f *fakeAuth) Signup(_ context.Context, email, pw string) (contract.User, auth.Session, error) {
	f.calls, f.email, f.pw = append(f.calls, "signup"), email, pw
	if f.err != nil {
		return contract.User{}, auth.Session{}, f.err
	}
	return testUser, f.session(), nil
}

func (f *fakeAuth) Login(_ context.Context, email, pw string) (contract.User, auth.Session, error) {
	f.calls, f.email, f.pw = append(f.calls, "login"), email, pw
	if f.err != nil {
		return contract.User{}, auth.Session{}, f.err
	}
	return testUser, f.session(), nil
}

func (f *fakeAuth) Logout(_ context.Context, token string) error {
	f.calls, f.loggedOut = append(f.calls, "logout"), append(f.loggedOut, token)
	return f.logoutErr
}

func (f *fakeAuth) Authenticate(_ context.Context, token string) (contract.User, *auth.Session, error) {
	f.calls, f.token = append(f.calls, "authenticate"), token
	if f.err != nil {
		return contract.User{}, nil, f.err
	}
	return testUser, f.renewed, nil
}

func authHandler(a *fakeAuth) http.Handler {
	return NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: a})
}

// send makes a request with a JSON body (if any) and the given headers ("Cookie", say).
func send(t *testing.T, h http.Handler, method, path, body string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const credentials = `{"email":"ann@example.com","password":"` + testPassword + `"}`

// sessionCookieSet returns the session cookie the response sets, if it sets one.
func sessionCookieSet(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	return nil
}

func TestSignupCreatesTheAccountAndSetsTheSessionCookie(t *testing.T) {
	a := &fakeAuth{}
	rec := send(t, authHandler(a), http.MethodPost, "/api/auth/signup", credentials)

	if rec.Code != http.StatusCreated || rec.Body.String() != `{"id":7,"email":"ann@example.com"}`+"\n" {
		t.Errorf("signup = %d %s, want 201 and the user", rec.Code, rec.Body)
	}
	if a.email != "ann@example.com" || a.pw != testPassword {
		t.Errorf("service got %q / %q", a.email, a.pw)
	}
	assertSessionCookie(t, rec)
}

func assertSessionCookie(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	header := rec.Header().Get("Set-Cookie")
	for _, want := range []string{"__Host-session=" + testToken, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"} {
		if !strings.Contains(header, want) {
			t.Errorf("Set-Cookie %q lacks %q", header, want)
		}
	}
	if strings.Contains(header, "Domain") {
		t.Errorf("Set-Cookie %q has a Domain, which __Host- cookies can't", header)
	}
	c := sessionCookieSet(rec)
	if c == nil {
		t.Fatal("no session cookie")
	}
	if want := int(auth.IdleTimeout.Seconds()); c.MaxAge < want-5 || c.MaxAge > want {
		t.Errorf("Max-Age = %d, want about %d (the session's expiry)", c.MaxAge, want)
	}
}

func TestLoginSetsTheSessionCookie(t *testing.T) {
	a := &fakeAuth{}
	rec := send(t, authHandler(a), http.MethodPost, "/api/auth/login", credentials)

	if rec.Code != http.StatusOK || rec.Body.String() != `{"id":7,"email":"ann@example.com"}`+"\n" {
		t.Errorf("login = %d %s, want 200 and the user", rec.Code, rec.Body)
	}
	assertSessionCookie(t, rec)
	if len(a.loggedOut) != 0 {
		t.Errorf("logged out %v with no previous session", a.loggedOut)
	}
}

func TestSigningInEndsTheBrowsersPreviousSession(t *testing.T) {
	for _, path := range []string{"/api/auth/login", "/api/auth/signup"} {
		a := &fakeAuth{}
		send(t, authHandler(a), http.MethodPost, path, credentials, "Cookie", sessionCookie+"=old-token")
		if len(a.loggedOut) != 1 || a.loggedOut[0] != "old-token" {
			t.Errorf("%s: logged out %v, want the old session", path, a.loggedOut)
		}
	}
}

func TestAuthErrorsGetTheirStatusAndNoCookie(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{"a bad sign-up", &auth.InputError{Reason: "use a longer password"}, 400, "use a longer password"},
		{"a taken email", auth.ErrEmailTaken, 409, "an account with that email already exists"},
		{"wrong credentials", auth.ErrBadCredentials, 401, "email or password is incorrect"},
		{"a timeout", context.DeadlineExceeded, 503, "that took too long; try again"},
		{"anything else", errors.New("ERROR: secret_table"), 500, "something went wrong"},
	} {
		for _, path := range []string{"/api/auth/signup", "/api/auth/login"} {
			rec := send(t, authHandler(&fakeAuth{err: tc.err}), http.MethodPost, path, credentials)
			if rec.Code != tc.status || assertJSONError(t, rec.Body.String()) != tc.body {
				t.Errorf("%s, %s = %d %s; want %d %q", tc.name, path, rec.Code, rec.Body, tc.status, tc.body)
			}
			if sessionCookieSet(rec) != nil {
				t.Errorf("%s, %s: set a session cookie", tc.name, path)
			}
		}
	}
}

func TestAFailedLoginIsLoggedWithoutTheCredentials(t *testing.T) {
	var logs strings.Builder
	captureLogs(t, &logs)
	send(t, authHandler(&fakeAuth{err: auth.ErrBadCredentials}), http.MethodPost, "/api/auth/login", credentials)

	if !strings.Contains(logs.String(), "login failed") || !strings.Contains(logs.String(), "client=192.0.2.1") {
		t.Errorf("logs = %q, want the failure and the client", logs.String())
	}
	if strings.Contains(logs.String(), "ann@") || strings.Contains(logs.String(), "horse") {
		t.Errorf("logs hold the credentials: %q", logs.String())
	}
}

func TestLogoutEndsTheSessionAndClearsTheCookie(t *testing.T) {
	a := &fakeAuth{}
	rec := send(t, authHandler(a), http.MethodPost, "/api/auth/logout", "", "Cookie", sessionCookie+"="+testToken)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec.Code)
	}
	if len(a.loggedOut) != 1 || a.loggedOut[0] != testToken {
		t.Errorf("logged out %v, want the cookie's session", a.loggedOut)
	}
	assertCookieCleared(t, rec)
}

func assertCookieCleared(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	c := sessionCookieSet(rec)
	if c == nil || c.MaxAge >= 0 || c.Value != "" || !c.Secure || c.Path != "/" {
		t.Errorf("Set-Cookie = %q, want the session cookie cleared", rec.Header().Get("Set-Cookie"))
	}
}

func TestLogoutWithoutASessionStillSucceeds(t *testing.T) {
	a := &fakeAuth{}
	rec := send(t, authHandler(a), http.MethodPost, "/api/auth/logout", "")
	if rec.Code != http.StatusNoContent || len(a.loggedOut) != 0 {
		t.Errorf("status = %d, logged out %v; want 204 and nothing to end", rec.Code, a.loggedOut)
	}
}

func TestLogoutReportsAFailureButStillClearsTheCookie(t *testing.T) {
	a := &fakeAuth{logoutErr: errors.New("connection refused")}
	rec := send(t, authHandler(a), http.MethodPost, "/api/auth/logout", "", "Cookie", sessionCookie+"="+testToken)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500, so the app can say logging out didn't work", rec.Code)
	}
	assertCookieCleared(t, rec)
}

func TestMeReturnsTheSignedInUser(t *testing.T) {
	a := &fakeAuth{}
	rec := send(t, authHandler(a), http.MethodGet, "/api/auth/me", "", "Cookie", sessionCookie+"="+testToken)

	if rec.Code != http.StatusOK || rec.Body.String() != `{"id":7,"email":"ann@example.com"}`+"\n" {
		t.Errorf("me = %d %s", rec.Code, rec.Body)
	}
	if a.token != testToken {
		t.Errorf("authenticated %q, want the cookie's token", a.token)
	}
	if sessionCookieSet(rec) != nil {
		t.Error("set the cookie though the session wasn't renewed")
	}
}

func TestMeRenewsTheCookieWhenTheSessionWasRenewed(t *testing.T) {
	a := &fakeAuth{renewed: &auth.Session{Token: testToken, ExpiresAt: time.Now().Add(auth.IdleTimeout)}}
	rec := send(t, authHandler(a), http.MethodGet, "/api/auth/me", "", "Cookie", sessionCookie+"="+testToken)
	assertSessionCookie(t, rec)
}

func TestMeWithoutAUsableSessionIs401(t *testing.T) {
	rec := send(t, authHandler(&fakeAuth{}), http.MethodGet, "/api/auth/me", "")
	if rec.Code != http.StatusUnauthorized || assertJSONError(t, rec.Body.String()) != "not signed in" {
		t.Errorf("no cookie: %d %s", rec.Code, rec.Body)
	}

	rec = send(t, authHandler(&fakeAuth{err: auth.ErrNoSession}), http.MethodGet, "/api/auth/me", "", "Cookie", sessionCookie+"=expired")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expired session: status %d, want 401", rec.Code)
	}
	assertCookieCleared(t, rec)
}

func TestCrossOriginWritesAreRefused(t *testing.T) {
	for name, headers := range map[string][]string{
		"another site":            {"Sec-Fetch-Site", "cross-site"},
		"a sibling subdomain":     {"Sec-Fetch-Site", "same-site"},
		"another Origin":          {"Origin", "https://evil.example"},
		"another port, by Origin": {"Origin", "http://example.com:9999"},
	} {
		for _, path := range []string{"/api/auth/signup", "/api/auth/login", "/api/auth/logout"} {
			a := &fakeAuth{}
			rec := send(t, authHandler(a), http.MethodPost, path, credentials, headers...)
			if rec.Code != http.StatusForbidden || len(a.calls) != 0 {
				t.Errorf("%s, %s: status %d, calls %v; want 403 and nothing done", name, path, rec.Code, a.calls)
			}
			assertJSONError(t, rec.Body.String())
		}
	}
}

func TestSameOriginWritesAreAllowed(t *testing.T) {
	for name, headers := range map[string][]string{
		"by Sec-Fetch-Site":         {"Sec-Fetch-Site", "same-origin"},
		"typed in by the user":      {"Sec-Fetch-Site", "none"},
		"by Origin":                 {"Origin", "http://example.com"},
		"no browser headers (curl)": nil,
	} {
		rec := send(t, authHandler(&fakeAuth{}), http.MethodPost, "/api/auth/login", credentials, headers...)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", name, rec.Code)
		}
	}
}

func TestBadBodiesAreRefusedBeforeTheService(t *testing.T) {
	for _, tc := range []struct {
		name, contentType, body string
		status                  int
		msg                     string
	}{
		{"a form post", "application/x-www-form-urlencoded", "email=a&password=b", 415, "send the body as application/json"},
		{"text/plain", "text/plain", credentials, 415, "send the body as application/json"},
		{"no type", "", credentials, 415, "send the body as application/json"},
		{"an unknown field", "application/json", `{"email":"a","password":"b","admin":true}`, 400, "the body isn't the JSON this endpoint takes"},
		{"two values", "application/json", credentials + credentials, 400, "the body isn't the JSON this endpoint takes"},
		{"not JSON", "application/json", `email=a`, 400, "the body isn't the JSON this endpoint takes"},
		{"empty", "application/json", ``, 400, "the body isn't the JSON this endpoint takes"},
		{"a wrong type", "application/json", `{"email":"a","password":12345}`, 400, "password has the wrong type"},
		{"too big", "application/json", `{"email":"a","password":"` + strings.Repeat("x", maxBodyBytes) + `"}`, 413, "the body can't be more than 16384 bytes"},
	} {
		a := &fakeAuth{}
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(tc.body))
		if tc.contentType != "" {
			req.Header.Set("Content-Type", tc.contentType)
		}
		rec := httptest.NewRecorder()
		authHandler(a).ServeHTTP(rec, req)
		if rec.Code != tc.status || assertJSONError(t, rec.Body.String()) != tc.msg || len(a.calls) != 0 {
			t.Errorf("%s: %d %s, calls %v; want %d %q and no call", tc.name, rec.Code, rec.Body, a.calls, tc.status, tc.msg)
		}
	}
}

func TestJSONWithACharsetIsAccepted(t *testing.T) {
	rec := send(t, authHandler(&fakeAuth{}), http.MethodPost, "/api/auth/login", credentials, "Content-Type", "application/json; charset=utf-8")
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestOnlyPOSTReachesTheAuthActions(t *testing.T) {
	for _, path := range []string{"/api/auth/signup", "/api/auth/login", "/api/auth/logout"} {
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
			a := &fakeAuth{}
			rec := send(t, authHandler(a), method, path, "")
			// A GET finds the JSON 404 for unknown API paths; other methods get the router's 405.
			want := map[string]int{http.MethodGet: http.StatusNotFound}[method]
			if want == 0 {
				want = http.StatusMethodNotAllowed
			}
			if rec.Code != want || len(a.calls) != 0 {
				t.Errorf("%s %s = %d, calls %v; want %d and no call", method, path, rec.Code, a.calls, want)
			}
		}
	}
}

func testLimits() *Limits {
	clock := func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) } // never refills
	return &Limits{
		PerClient:     &ratelimit.Keyed{Rate: 1, Burst: 100, Now: clock},
		AuthPerClient: &ratelimit.Keyed{Rate: rate.Every(time.Minute), Burst: 3, Now: clock},
		LoginPerEmail: &ratelimit.Keyed{Rate: rate.Every(time.Minute), Burst: 2, Now: clock},
	}
}

func fromClient(ip string) func(*http.Request) {
	return func(r *http.Request) { r.RemoteAddr = ip + ":1234" }
}

func post(t *testing.T, h http.Handler, path, body string, edit func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	edit(req)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSigningUpAndLoggingInAreLimitedPerClient(t *testing.T) {
	a := &fakeAuth{}
	h := NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: a, Limits: testLimits()})
	for i, path := range []string{"/api/auth/signup", "/api/auth/login", "/api/auth/signup"} {
		body := `{"email":"user` + string(rune('a'+i)) + `@example.com","password":"x"}`
		if rec := post(t, h, path, body, fromClient("192.0.2.1")); rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was limited", i+1)
		}
	}
	rec := post(t, h, "/api/auth/login", `{"email":"other@example.com","password":"x"}`, fromClient("192.0.2.1"))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "60" {
		t.Errorf("4th request = %d, Retry-After %q; want 429 and 60", rec.Code, rec.Header().Get("Retry-After"))
	}
	assertJSONError(t, rec.Body.String())
	if len(a.calls) != 3 {
		t.Errorf("service calls = %v, want only the 3 allowed", a.calls)
	}
	if rec := post(t, h, "/api/auth/login", credentials, fromClient("198.51.100.9")); rec.Code != http.StatusOK {
		t.Errorf("another client was limited: %d", rec.Code)
	}
}

func TestLoggingInIsLimitedPerEmailWhateverTheClient(t *testing.T) {
	h := NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: &fakeAuth{}, Limits: testLimits()})
	post(t, h, "/api/auth/login", `{"email":"ann@example.com","password":"x"}`, fromClient("192.0.2.1"))
	post(t, h, "/api/auth/login", `{"email":" ANN@example.com ","password":"x"}`, fromClient("192.0.2.2"))
	rec := post(t, h, "/api/auth/login", `{"email":"Ann@Example.com","password":"x"}`, fromClient("192.0.2.3"))
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("3rd login to one account from a 3rd client = %d, want 429", rec.Code)
	}
	if rec := post(t, h, "/api/auth/login", `{"email":"bob@example.com","password":"x"}`, fromClient("192.0.2.3")); rec.Code != http.StatusOK {
		t.Errorf("another account was limited: %d", rec.Code)
	}
}

func TestEveryAPIRequestIsLimitedPerClient(t *testing.T) {
	l := testLimits()
	l.PerClient.Burst = 2
	h := NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: &fakeAuth{}, Limits: l})
	for _, path := range []string{"/api/health", "/api/cards/search?q=bolt"} {
		if rec := get(t, h, http.MethodGet, path); rec.Code != http.StatusOK {
			t.Fatalf("%s = %d", path, rec.Code)
		}
	}
	rec := get(t, h, http.MethodGet, "/api/nope")
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("3rd request = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Error("the 429 lacks the security headers")
	}
}

func TestTheDefaultLimitsAllowAPersonSearching(t *testing.T) {
	l := DefaultLimits()
	for i := range 60 { // a burst of autocomplete requests, say
		if ok, _ := l.PerClient.Allow("192.0.2.1"); !ok {
			t.Fatalf("request %d of a burst of 60 was limited", i+1)
		}
	}
	for name, k := range map[string]*ratelimit.Keyed{"auth": l.AuthPerClient, "login": l.LoginPerEmail} {
		for i := range 10 {
			if ok, _ := k.Allow("x"); !ok {
				t.Fatalf("%s: attempt %d of 10 was limited", name, i+1)
			}
		}
		if ok, _ := k.Allow("x"); ok {
			t.Errorf("%s: an 11th attempt at once was allowed", name)
		}
	}
}
