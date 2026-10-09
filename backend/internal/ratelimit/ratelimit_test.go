package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newClock() *clock                   { return &clock{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)} }
func allowed(k *Keyed, key string) bool  { ok, _ := k.Allow(key); return ok }

func TestABurstIsAllowedThenRequestsWaitForTheRefill(t *testing.T) {
	c := newClock()
	k := &Keyed{Rate: 1, Burst: 3, Now: c.now} // 3 at once, then 1 a second

	for i := range 3 {
		if !allowed(k, "a") {
			t.Fatalf("request %d of the burst was refused", i+1)
		}
	}
	ok, wait := k.Allow("a")
	if ok || wait != time.Second {
		t.Errorf("4th request = %v, wait %v; want refused, 1s", ok, wait)
	}
	c.advance(500 * time.Millisecond)
	if ok, wait := k.Allow("a"); ok || wait != 500*time.Millisecond {
		t.Errorf("after 0.5s = %v, wait %v; want refused, 0.5s (a refused request doesn't use up the refill)", ok, wait)
	}
	c.advance(500 * time.Millisecond)
	if !allowed(k, "a") {
		t.Error("refused after the refill")
	}
}

func TestKeysHaveTheirOwnBuckets(t *testing.T) {
	k := &Keyed{Rate: 1, Burst: 1, Now: newClock().now}
	if !allowed(k, "a") || allowed(k, "a") {
		t.Fatal("a: want one allowed, then refused")
	}
	if !allowed(k, "b") {
		t.Error("b was refused because a used its bucket")
	}
}

func TestIdleBucketsAreDropped(t *testing.T) {
	c := newClock()
	k := &Keyed{Rate: 1, Burst: 10, Now: c.now}
	k.Allow("a")
	c.advance(9 * time.Second)
	k.Allow("b")
	c.advance(sweepEvery) // a idle 69s, b 60s: both full again (10s)
	k.Allow("c")
	if k.Len() != 1 {
		t.Errorf("tracking %d keys, want only c", k.Len())
	}
}

func TestABucketIsKeptWhileItIsStillRefilling(t *testing.T) {
	c := newClock()
	k := &Keyed{Rate: 0.01, Burst: 2, Now: c.now} // refills in 200s
	k.Allow("a")
	k.Allow("a")
	c.advance(sweepEvery)
	k.Allow("b")
	if allowed(k, "a") {
		t.Error("a's empty bucket was dropped by the sweep, giving it a fresh burst")
	}
}

func TestNewKeysShareABucketOnceTheLimitIsReached(t *testing.T) {
	k := &Keyed{Rate: 1, Burst: 2, MaxKeys: 3, Now: newClock().now}
	for i := range 3 {
		k.Allow(fmt.Sprint(i))
	}
	if !allowed(k, "x") || !allowed(k, "y") {
		t.Fatal("overflow keys were refused before the shared bucket was empty")
	}
	if allowed(k, "z") {
		t.Error("a third overflow key was allowed: the overflow keys don't share a bucket")
	}
	if k.Len() != 3 {
		t.Errorf("tracking %d keys, want the limit of 3", k.Len())
	}
	if !allowed(k, "0") {
		t.Error("a tracked key was refused because the overflow bucket is empty")
	}
}

func TestZeroBurstRefusesEverything(t *testing.T) {
	k := &Keyed{Rate: 1, Burst: 0}
	if ok, _ := k.Allow("a"); ok {
		t.Error("allowed with a burst of 0")
	}
}

func TestClientKeys(t *testing.T) {
	for in, want := range map[string]string{
		"192.0.2.7:51234":            "192.0.2.7",
		"[::ffff:192.0.2.7]:80":      "192.0.2.7",
		"[2001:db8:1:2:3:4:5:6]:443": "2001:db8:1:2::/64",
		"[2001:db8:1:2:ffff::1]:443": "2001:db8:1:2::/64",
		"[fe80::1%eth0]:80":          "fe80::/64",
		"[::1]:8080":                 "::/64",
		"not an address":             "unknown",
		"192.0.2.7":                  "unknown",
	} {
		if got := ClientKey(in); got != want {
			t.Errorf("ClientKey(%q) = %q, want %q", in, got, want)
		}
	}
}
