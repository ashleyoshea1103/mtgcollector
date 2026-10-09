package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/time/rate"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/ratelimit"
)

// Limits are how often clients may call the API. A client is the request's remote IP (an
// IPv6 /64): behind a reverse proxy every request comes from the proxy, so these would be
// shared by everyone (see "Running it for real" in the README).
type Limits struct {
	// Every API request, by client: generous for a person searching, and it keeps a flood
	// of ordinary searches from one client from filling the database's connection pool.
	PerClient *ratelimit.Keyed
	// Signing up and logging in, by client: each is a deliberately slow password hash.
	AuthPerClient *ratelimit.Keyed
	// Logging in, by the email being logged in to: guessing one account's password from
	// many addresses is slow too.
	LoginPerEmail *ratelimit.Keyed
}

// DefaultLimits returns the limits the server uses.
func DefaultLimits() *Limits {
	return &Limits{
		PerClient:     &ratelimit.Keyed{Rate: 20, Burst: 60},
		AuthPerClient: &ratelimit.Keyed{Rate: rate.Every(6 * time.Second), Burst: 10},
		LoginPerEmail: &ratelimit.Keyed{Rate: rate.Every(time.Minute), Burst: 10},
	}
}

// limit refuses requests from a client that has used up its allowance.
func limit(l *ratelimit.Keyed, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allow(w, l, ratelimit.ClientKey(r.RemoteAddr)) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// allow takes a request from key's allowance, or answers 429 and says when to try again.
func allow(w http.ResponseWriter, l *ratelimit.Keyed, key string) bool {
	ok, wait := l.Allow(key)
	if ok {
		return true
	}
	if wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	}
	writeError(w, http.StatusTooManyRequests, "too many requests; try again shortly")
	return false
}
