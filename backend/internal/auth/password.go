package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"
)

// argon2id settings, as stored in each hash.
type params struct {
	memory  uint32 // KiB
	time    uint32
	threads uint8
}

// OWASP's recommended argon2id minimum: 19 MiB, 2 passes, 1 thread. Hashes made with other
// settings still verify, and are replaced with these at the next login.
var current = params{memory: 19 * 1024, time: 2, threads: 1}

const (
	saltLen = 16
	keyLen  = 32
)

// Bounds on the settings a stored hash may ask for, so a corrupt or planted row can't make a
// login allocate gigabytes or run for minutes.
const (
	maxMemory  = 256 * 1024 // KiB
	maxTime    = 10
	maxThreads = 16
)

var errMalformedHash = errors.New("malformed password hash")

// normalize gives a password one form however it was typed: NFKC, as NIST SP 800-63B
// advises, so the same characters entered differently (e.g. a precomposed é or e + ◌́) match.
func normalize(password string) []byte {
	return []byte(norm.NFKC.String(password))
}

// hashPassword returns the password's argon2id hash in the PHC string format.
func hashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	return encode(current, salt, derive(current, normalize(password), salt, keyLen)), nil
}

func derive(p params, password, salt []byte, n uint32) []byte {
	return argon2.IDKey(password, salt, p.time, p.memory, p.threads, n)
}

func encode(p params, salt, key []byte) string {
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memory, p.time, p.threads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// verifyPassword reports whether password matches the encoded hash, and whether the hash
// should be replaced because it was made with other settings.
func verifyPassword(encoded, password string) (match, stale bool, err error) {
	p, salt, key, err := decode(encoded)
	if err != nil {
		return false, false, err
	}
	got := derive(p, normalize(password), salt, uint32(len(key)))
	return subtle.ConstantTimeCompare(got, key) == 1, p != current || len(salt) != saltLen || len(key) != keyLen, nil
}

func decode(encoded string) (p params, salt, key []byte, err error) {
	// "", "argon2id", "v=19", "m=…,t=…,p=…", salt, key
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return p, nil, nil, errMalformedHash
	}
	if parts[2] != fmt.Sprintf("v=%d", argon2.Version) {
		return p, nil, nil, errMalformedHash
	}
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil || n != 3 ||
		fmt.Sprintf("m=%d,t=%d,p=%d", p.memory, p.time, p.threads) != parts[3] {
		return p, nil, nil, errMalformedHash
	}
	if p.time < 1 || p.time > maxTime || p.threads < 1 || p.threads > maxThreads ||
		p.memory < 8*uint32(p.threads) || p.memory > maxMemory {
		return p, nil, nil, errMalformedHash
	}
	b64 := base64.RawStdEncoding.Strict()
	if salt, err = b64.DecodeString(parts[4]); err != nil || len(salt) < 8 || len(salt) > 64 {
		return p, nil, nil, errMalformedHash
	}
	if key, err = b64.DecodeString(parts[5]); err != nil || len(key) < 16 || len(key) > 64 {
		return p, nil, nil, errMalformedHash
	}
	return p, salt, key, nil
}
