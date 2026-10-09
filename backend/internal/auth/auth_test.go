package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

func TestAPasswordVerifiesAgainstItsOwnHashOnly(t *testing.T) {
	hash, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("hash = %q, want argon2id with OWASP's settings in the PHC format", hash)
	}
	for _, tc := range []struct {
		password string
		match    bool
	}{
		{"correct horse battery staple", true},
		{"correct horse battery staplE", false},
		{"correct horse battery staple ", false},
		{"", false},
	} {
		match, stale, err := verifyPassword(hash, tc.password)
		if err != nil || match != tc.match || stale {
			t.Errorf("verify(%q) = %v, stale %v, %v; want %v, fresh", tc.password, match, stale, err, tc.match)
		}
	}
}

func TestHashingTheSamePasswordTwiceGivesDifferentHashes(t *testing.T) {
	a, _ := hashPassword("correct horse battery staple")
	b, _ := hashPassword("correct horse battery staple")
	if a == b {
		t.Error("two hashes of one password are equal: the salt isn't random")
	}
}

func TestPasswordsMatchHoweverTheirCharactersAreComposed(t *testing.T) {
	hash, _ := hashPassword("café au lait s'il vous plaît") // precomposed é and î
	match, _, err := verifyPassword(hash, "café au lait s'il vous plaît")
	if err != nil || !match {
		t.Errorf("decomposed accents didn't match the precomposed password: %v, %v", match, err)
	}
}

func TestAHashWithOtherSettingsVerifiesAndIsStale(t *testing.T) {
	old := params{memory: 8 * 1024, time: 3, threads: 2}
	salt := []byte("0123456789abcdef")
	hash := encode(old, salt, derive(old, normalize("an older hashed password"), salt, keyLen))

	match, stale, err := verifyPassword(hash, "an older hashed password")
	if err != nil || !match || !stale {
		t.Errorf("verify = %v, stale %v, %v; want a stale match", match, stale, err)
	}
	if match, _, _ := verifyPassword(hash, "another password!!"); match {
		t.Error("a wrong password matched an old-settings hash")
	}
}

func TestMalformedOrExtravagantHashesAreRefused(t *testing.T) {
	good, _ := hashPassword("correct horse battery staple")
	parts := strings.Split(good, "$")
	with := func(i int, v string) string {
		p := append([]string(nil), parts...)
		p[i] = v
		return strings.Join(p, "$")
	}
	for name, hash := range map[string]string{
		"empty":             "",
		"bcrypt":            "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234",
		"argon2i":           with(1, "argon2i"),
		"old version":       with(2, "v=16"),
		"too much memory":   with(3, "m=1048576,t=2,p=1"),
		"too many passes":   with(3, "m=19456,t=11,p=1"),
		"no passes":         with(3, "m=19456,t=0,p=1"),
		"too many threads":  with(3, "m=19456,t=2,p=17"),
		"threads overflow":  with(3, "m=19456,t=2,p=257"),
		"memory under 8xp":  with(3, "m=8,t=1,p=2"),
		"padded number":     with(3, "m=019456,t=2,p=1"),
		"extra setting":     with(3, "m=19456,t=2,p=1,x=1"),
		"bad salt":          with(4, "!!!"),
		"short salt":        with(4, "AAAA"),
		"short key":         with(5, "AAAA"),
		"padded base64":     with(5, parts[5]+"="),
		"extra part":        good + "$x",
		"missing leading $": good[1:],
	} {
		if _, _, err := verifyPassword(hash, "correct horse battery staple"); !errors.Is(err, errMalformedHash) {
			t.Errorf("%s: err = %v, want errMalformedHash", name, err)
		}
	}
}

func TestTheDummyHashMatchesNoPasswordAndUsesTheCurrentSettings(t *testing.T) {
	for _, pw := range []string{"", "correct horse battery staple", "\x00"} {
		match, stale, err := verifyPassword(dummyHash(), pw)
		if err != nil || match || stale {
			t.Errorf("verify(dummy, %q) = %v, stale %v, %v; want no match with current settings", pw, match, stale, err)
		}
	}
}

func TestTokensAreRandomAndOnlyTheirHashIsKept(t *testing.T) {
	a, hashA, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := newToken()
	if a == b {
		t.Error("two tokens are equal")
	}
	if len(a) != 43 || len(hashA) != 32 {
		t.Errorf("token %q (%d chars), hash %d bytes; want 43 chars and a 32-byte SHA-256", a, len(a), len(hashA))
	}
	if again, ok := hashToken(a); !ok || string(again) != string(hashA) {
		t.Error("hashing a token again gave another hash")
	}
	if strings.Contains(string(hashA), a) {
		t.Error("the hash holds the token")
	}
}

func TestStringsThatCantBeTokensHaveNoHash(t *testing.T) {
	good, _, _ := newToken()
	for _, s := range []string{"", "x", good + "A", good[:42], good[:42] + "+", good[:42] + "=", strings.Repeat("A", 4096)} {
		if _, ok := hashToken(s); ok {
			t.Errorf("hashToken(%q) accepted it", s)
		}
	}
}

func TestEmailChecks(t *testing.T) {
	for _, ok := range []string{"ann@example.com", "Ann.Lee+mtg@mail.example.co.uk", "jörg@bücher.example"} {
		if err := checkEmail(ok); err != nil {
			t.Errorf("checkEmail(%q) = %v, want ok", ok, err)
		}
	}
	for _, bad := range []string{
		"", "ann", "ann@", "@example.com", "ann@localhost", "Ann <ann@example.com>", "ann@example.com (Ann)",
		"ann@example.com, bob@example.com", "ann @example.com", "ann@exa\x00mple.com",
		strings.Repeat("a", 243) + "@example.com", // 255 characters
	} {
		var input *InputError
		if err := checkEmail(bad); !errors.As(err, &input) {
			t.Errorf("checkEmail(%q) = %v, want an InputError", bad, err)
		}
	}
	if err := checkEmail(strings.Repeat("a", 242) + "@example.com"); err != nil { // 254
		t.Errorf("a 254-character address was refused: %v", err)
	}
}

func TestPasswordChecks(t *testing.T) {
	min, max := contract.MinPasswordLength, contract.MaxPasswordLength
	for name, tc := range map[string]struct {
		password string
		ok       bool
	}{
		"shortest":                  {strings.Repeat("a", min), true},
		"one too short":             {strings.Repeat("a", min-1), false},
		"longest":                   {strings.Repeat("a", max), true},
		"one too long":              {strings.Repeat("a", max+1), false},
		"counted in characters":     {strings.Repeat("é", min), true},     // 30 bytes, 15 characters
		"short in characters":       {strings.Repeat("é", min-1), false},  // 28 bytes
		"counted after normalizing": {strings.Repeat("é", min-1), false}, // 28 code points, 14 characters
		"spaces count":              {"a b c d e f g h", true},
		"the email":                 {"ann.lee@example.com", false},
		"the email, other case":     {" ANN.LEE@example.com ", false},
		"not UTF-8":                 {strings.Repeat("\xff", min), false},
	} {
		err := checkPassword(tc.password, "ann.lee@example.com")
		var input *InputError
		if tc.ok && err != nil || !tc.ok && !errors.As(err, &input) {
			t.Errorf("%s: checkPassword = %v, want ok %v", name, err, tc.ok)
		}
	}
}

func TestExpiryMovesWithUseButNotPastTheAbsoluteLimit(t *testing.T) {
	created := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	if got, want := expiry(created, created), created.Add(IdleTimeout); !got.Equal(want) {
		t.Errorf("new session expires %v, want %v", got, want)
	}
	later := created.Add(10 * 24 * time.Hour)
	if got, want := expiry(later, created), later.Add(IdleTimeout); !got.Equal(want) {
		t.Errorf("used after 10 days: expires %v, want %v", got, want)
	}
	nearEnd := created.Add(AbsoluteTimeout - time.Hour)
	if got, want := expiry(nearEnd, created), created.Add(AbsoluteTimeout); !got.Equal(want) {
		t.Errorf("used near the absolute limit: expires %v, want %v", got, want)
	}
	if got := expiry(time.Date(2026, 1, 1, 0, 0, 0, 1999, time.UTC), created.Add(-time.Hour)); got.Nanosecond()%1000 != 0 {
		t.Errorf("expiry %v has sub-microsecond precision, which Postgres would drop", got)
	}
}
