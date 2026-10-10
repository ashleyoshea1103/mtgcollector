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

func TestPastMaxKeysTheLeastRecentlySeenKeyIsForgotten(t *testing.T) {
	c := newClock()
	k := &Keyed{Rate: 1, Burst: 1, MaxKeys: 3, Now: c.now}
	for _, key := range []string{"a", "b", "c"} {
		k.Allow(key)
		c.advance(time.Millisecond)
	}
	k.Allow("a") // seen again: b is now the least recent
	if !allowed(k, "d") {
		t.Fatal("a new key was refused when the limit was reached")
	}
	if k.Len() != 3 {
		t.Errorf("tracking %d keys, want the limit of 3", k.Len())
	}
	if allowed(k, "a") || allowed(k, "c") {
		t.Error("a recently seen key was forgotten, getting a fresh bucket")
	}
	if !allowed(k, "b") {
		t.Error("b, the least recently seen, wasn't the one forgotten")
	}
}

func TestAFloodOfNewKeysDoesntLimitOtherClients(t *testing.T) {
	k := &Keyed{Rate: 1, Burst: 1, MaxKeys: 100, Now: newClock().now}
	for i := range 10_000 {
		k.Allow(fmt.Sprint("attacker-", i))
	}
	for i := range 50 {
		if !allowed(k, fmt.Sprint("user-", i)) {
			t.Fatalf("user %d was refused after a flood of other keys", i)
		}
	}
}

func TestSweepingDropsABucketOnlyOnceItIsFullAgain(t *testing.T) {
	c := newClock()
	start := c.t
	k := &Keyed{Rate: 1, Burst: 10, Now: c.now} // refills in 10s
	k.Allow("a")
	c.t = start.Add(sweepEvery - 10*time.Second)
	k.Allow("b") // idle exactly 10s at the sweep: full again
	c.t = start.Add(sweepEvery - 10*time.Second + time.Millisecond)
	k.Allow("c") // idle just under 10s: not yet
	c.t = start.Add(sweepEvery)
	k.Allow("d") // the sweep runs
	if k.Len() != 2 {
		t.Errorf("after the sweep, tracking %d keys, want c and d", k.Len())
	}
}

func TestARefundGivesTheRequestBack(t *testing.T) {
	k := &Keyed{Rate: 1, Burst: 1, Now: newClock().now}
	ok, _, refund := k.Take("a")
	if !ok {
		t.Fatal("refused")
	}
	refund()
	if !allowed(k, "a") {
		t.Error("refused after the refund")
	}
	if allowed(k, "a") {
		t.Error("allowed twice from a bucket of one")
	}
	if ok, _, refund := k.Take("a"); ok || refund != nil {
		t.Error("a refused request came with a refund")
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
		"[2001:db8:1:2:3:4:5:6]:443": "2001:db8:1::/56",
		"[2001:db8:1:ff::1]:443":     "2001:db8:1::/56",
		"[2001:db8:1:100::1]:443":    "2001:db8:1:100::/56",
		"[fe80::1%eth0]:80":          "fe80::/56",
		"[::1]:8080":                 "::/56",
		"not an address":             "unknown",
		"192.0.2.7":                  "unknown",
	} {
		if got := ClientKey(in); got != want {
			t.Errorf("ClientKey(%q) = %q, want %q", in, got, want)
		}
	}
}
