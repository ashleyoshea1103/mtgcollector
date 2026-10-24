// Package ratelimit limits how often each client (an IP address, an account being logged in
// to from one client) may do something, with a token bucket per key held in memory. Limits
// are per server process and start afresh when it restarts.
package ratelimit

import (
	"container/list"
	"net/netip"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Keyed is a token bucket for each key: Burst requests at once, refilled at Rate.
type Keyed struct {
	Rate  rate.Limit
	Burst int
	// MaxKeys bounds memory: past it, the key seen least recently is forgotten (as if its
	// bucket were full again). Zero means DefaultMaxKeys. Callers keep keys short (an IP
	// address, a hash), so that's a bound on bytes too.
	MaxKeys int
	Now     func() time.Time // the clock; nil means time.Now

	mu        sync.Mutex
	buckets   map[string]*list.Element // of *bucket
	byUse     *list.List               // most recently seen first
	lastSweep time.Time
}

// DefaultMaxKeys is about 20 MB of buckets.
const DefaultMaxKeys = 100_000

// How often idle buckets are looked for.
const sweepEvery = time.Minute

type bucket struct {
	key  string
	lim  *rate.Limiter
	seen time.Time
}

// Allow takes a request from key's bucket. When the bucket is empty it returns false and how
// long until a request would be allowed.
func (k *Keyed) Allow(key string) (bool, time.Duration) {
	ok, wait, _ := k.Take(key)
	return ok, wait
}

// Take is Allow, and when the request is allowed it also returns refund, which gives the
// request back: for counting only the attempts that turn out to fail, say.
func (k *Keyed) Take(key string) (ok bool, wait time.Duration, refund func()) {
	now := k.now()
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.buckets == nil {
		k.buckets = map[string]*list.Element{}
		k.byUse = list.New()
		k.lastSweep = now
	}
	if now.Sub(k.lastSweep) >= sweepEvery {
		k.sweep(now)
	}
	lim := k.limiter(key, now)
	r := lim.ReserveN(now, 1)
	if !r.OK() {
		return false, 0, nil
	}
	if wait := r.DelayFrom(now); wait > 0 {
		r.CancelAt(now)
		return false, wait, nil
	}
	return true, 0, func() { r.CancelAt(k.now()) }
}

func (k *Keyed) now() time.Time {
	if k.Now != nil {
		return k.Now()
	}
	return time.Now()
}

func (k *Keyed) limiter(key string, now time.Time) *rate.Limiter {
	if e, ok := k.buckets[key]; ok {
		b := e.Value.(*bucket)
		b.seen = now
		k.byUse.MoveToFront(e)
		return b.lim
	}
	maxKeys := k.MaxKeys
	if maxKeys == 0 {
		maxKeys = DefaultMaxKeys
	}
	for len(k.buckets) >= maxKeys {
		k.remove(k.byUse.Back())
	}
	b := &bucket{key: key, lim: rate.NewLimiter(k.Rate, k.Burst), seen: now}
	k.buckets[key] = k.byUse.PushFront(b)
	return b.lim
}

func (k *Keyed) remove(e *list.Element) {
	delete(k.buckets, e.Value.(*bucket).key)
	k.byUse.Remove(e)
}

// sweep drops buckets that have been idle long enough to be full again: a new bucket for the
// key would behave the same. Buckets are in order of use, so it stops at the first that isn't.
func (k *Keyed) sweep(now time.Time) {
	k.lastSweep = now
	if k.Rate <= 0 {
		return // buckets never refill, so none can go
	}
	refill := time.Duration(min(float64(k.Burst)/float64(k.Rate), 1e9) * float64(time.Second)) // rate.Inf: 0
	for e := k.byUse.Back(); e != nil && now.Sub(e.Value.(*bucket).seen) >= refill; e = k.byUse.Back() {
		k.remove(e)
	}
}

// Len is how many keys are being tracked.
func (k *Keyed) Len() int {
	k.mu.Lock()
	defer k.mu.Unlock()
	return len(k.buckets)
}

// ClientKey turns a request's remote address ("ip:port") into the key for its client: the IP,
// or for IPv6 its /56 network, since one subscriber is usually given at least that much.
func ClientKey(remoteAddr string) string {
	ap, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return "unknown"
	}
	addr := ap.Addr().Unmap()
	if addr.Is6() {
		p, _ := addr.Prefix(56)
		return p.String()
	}
	return addr.String()
}
