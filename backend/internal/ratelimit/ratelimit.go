// Package ratelimit limits how often each client (an IP address, an email address being
// logged in to) may do something, with a token bucket per key held in memory. Limits are
// per server process and start afresh when it restarts.
package ratelimit

import (
	"net/netip"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Keyed is a token bucket for each key: Burst requests at once, refilled at Rate.
type Keyed struct {
	Rate  rate.Limit
	Burst int
	// MaxKeys bounds memory: once that many keys are being tracked, new keys share one bucket
	// until idle ones are dropped. Zero means DefaultMaxKeys.
	MaxKeys int
	Now     func() time.Time // the clock; nil means time.Now

	mu        sync.Mutex
	buckets   map[string]*bucket
	overflow  *rate.Limiter
	lastSweep time.Time
}

// DefaultMaxKeys is about 10 MB of buckets.
const DefaultMaxKeys = 100_000

// How often idle buckets are looked for.
const sweepEvery = time.Minute

type bucket struct {
	lim  *rate.Limiter
	seen time.Time
}

// Allow takes a request from key's bucket. When the bucket is empty it returns false and how
// long until a request would be allowed.
func (k *Keyed) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	if k.Now != nil {
		now = k.Now()
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.buckets == nil {
		k.buckets = map[string]*bucket{}
		k.overflow = rate.NewLimiter(k.Rate, k.Burst)
		k.lastSweep = now
	}
	if now.Sub(k.lastSweep) >= sweepEvery {
		k.sweep(now)
	}
	lim := k.limiter(key, now)
	r := lim.ReserveN(now, 1)
	if !r.OK() {
		return false, 0
	}
	if wait := r.DelayFrom(now); wait > 0 {
		r.CancelAt(now)
		return false, wait
	}
	return true, 0
}

func (k *Keyed) limiter(key string, now time.Time) *rate.Limiter {
	if b, ok := k.buckets[key]; ok {
		b.seen = now
		return b.lim
	}
	maxKeys := k.MaxKeys
	if maxKeys == 0 {
		maxKeys = DefaultMaxKeys
	}
	if len(k.buckets) >= maxKeys {
		return k.overflow
	}
	b := &bucket{lim: rate.NewLimiter(k.Rate, k.Burst), seen: now}
	k.buckets[key] = b
	return b.lim
}

// sweep drops buckets that have been idle long enough to be full again: a new bucket for the
// key would behave the same.
func (k *Keyed) sweep(now time.Time) {
	k.lastSweep = now
	if k.Rate <= 0 {
		return // buckets never refill, so none can go
	}
	refill := time.Duration(min(float64(k.Burst)/float64(k.Rate), 1e9) * float64(time.Second)) // rate.Inf: 0
	for key, b := range k.buckets {
		if now.Sub(b.seen) >= refill {
			delete(k.buckets, key)
		}
	}
}

// Len is how many keys are being tracked.
func (k *Keyed) Len() int {
	k.mu.Lock()
	defer k.mu.Unlock()
	return len(k.buckets)
}

// ClientKey turns a request's remote address ("ip:port") into the key for its client: the IP,
// or for IPv6 its /64 network, since one connection usually has a whole /64 to pick from.
func ClientKey(remoteAddr string) string {
	ap, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return "unknown"
	}
	addr := ap.Addr().Unmap()
	if addr.Is6() {
		p, _ := addr.Prefix(64)
		return p.String()
	}
	return addr.String()
}
