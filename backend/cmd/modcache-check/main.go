// Command modcache-check is the pre-push hook's tripwire for its own Go module cache
// (.git/pre-push-go/mod). Verifying a push runs the pushed code, which could edit a module in
// that cache so that later verifications compile the edit in. The go command checks a cached
// module's recorded hash (cache/download/<module>/@v/<version>.ziphash) against go.sum each
// time it uses the module, but never re-hashes the extracted files. `go mod verify` does, for
// every module a build uses, which takes minutes on a cache this size.
//
// So this keeps a fingerprint of each extracted module directory: every file's path, size,
// modification time and mode, plus a stamp no program can set back (the inode and change time
// on Linux and macOS, the NTFS change journal's sequence number on Windows), so an edit that
// keeps a file's size and puts back its modification time still shows. Only the directories
// whose fingerprint changed are hashed and compared with the recorded hash, as `go mod verify`
// would. Like the hook's other checks, it's a tripwire, not a sandbox.
//
// Usage:
//
//	modcache-check check [-baseline -] <module cache> <state file>
//	modcache-check prune [-keep 720h] <module cache> <state file> <directories-in-use
//
// check compares the cache with the fingerprints in the state file. On the first run, with no
// fingerprints yet, it hashes every module. It exits 1, listing the problems, if a module's
// files don't match its recorded hash, and records the new fingerprints only when all do.
// With -baseline -, the fingerprints to compare with are read from standard input instead: the
// hook keeps its own copy of the state file while it verifies, as the code being verified could
// rewrite the file to hide an edit (and another push, running alongside, rewrites it anyway).
//
// prune deletes the modules nothing has used for -keep, so the cache doesn't keep every
// version Dependabot has moved past. Standard input lists the module directories in use, one
// per line (`go list -m -f '{{.Dir}}' all`), and those are marked as used now.
//
// scripts/install-hooks.sh builds it into .git/hooks, next to the hook. It uses only the
// standard library, so building it downloads nothing.
package main

import (
	"archive/zip"
	"bufio"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

const usage = `usage: modcache-check check [-baseline -] <module cache> <state file>
       modcache-check prune [-keep 720h] <module cache> <state file> <directories-in-use`

// run is the command line: exit status 0 when the cache checks out, 1 when it doesn't, and 2
// when it couldn't be checked.
func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	switch args[0] {
	case "check":
		flags := flag.NewFlagSet("check", flag.ContinueOnError)
		flags.SetOutput(stderr)
		baselineFrom := flags.String("baseline", "", `"-" to read the fingerprints to compare with from standard input`)
		if flags.Parse(args[1:]) != nil || flags.NArg() != 2 || (*baselineFrom != "" && *baselineFrom != "-") {
			break
		}
		var baseline io.Reader
		if *baselineFrom == "-" {
			baseline = stdin
		}
		problems, err := check(flags.Arg(0), flags.Arg(1), baseline, stdout)
		if err != nil {
			fmt.Fprintln(stderr, "modcache-check:", err)
			return 2
		}
		for _, p := range problems {
			fmt.Fprintln(stderr, "modcache-check:", p)
		}
		if len(problems) > 0 {
			return 1
		}
		return 0
	case "prune":
		flags := flag.NewFlagSet("prune", flag.ContinueOnError)
		flags.SetOutput(stderr)
		keep := flags.Duration("keep", 30*24*time.Hour, "delete modules not used for this long")
		if flags.Parse(args[1:]) != nil || flags.NArg() != 2 {
			break
		}
		inUse, err := readLines(stdin)
		if err == nil {
			err = prune(flags.Arg(0), flags.Arg(1), inUse, *keep, time.Now(), stderr)
		}
		if err != nil {
			fmt.Fprintln(stderr, "modcache-check:", err)
			return 2
		}
		return 0
	}
	fmt.Fprintln(stderr, usage)
	return 2
}

func readLines(r io.Reader) ([]string, error) {
	var lines []string
	s := bufio.NewScanner(r)
	for s.Scan() {
		if line := strings.TrimSpace(s.Text()); line != "" {
			lines = append(lines, line)
		}
	}
	return lines, s.Err()
}

// check compares the cache with the fingerprints in baseline (or, if that's nil, the state
// file), hashes the modules that changed, and returns what's wrong. It saves the new
// fingerprints to the state file only if nothing is.
func check(modcache, stateFile string, baseline io.Reader, out io.Writer) ([]string, error) {
	var old state
	existed := true
	var err error
	if baseline != nil {
		var data []byte
		if data, err = io.ReadAll(baseline); err == nil {
			old, err = parseState(data, "the baseline")
		}
		// Last-used times only decide what prune deletes, so the file's newer ones are kept.
		if onDisk, _, err := loadState(stateFile); err == nil {
			for root, e := range old {
				e.lastUsed = max(e.lastUsed, onDisk[root].lastUsed)
				old[root] = e
			}
		}
	} else {
		old, existed, err = loadState(stateFile)
	}
	if err != nil {
		return nil, err
	}
	now, problems, err := scan(modcache)
	if err != nil {
		return nil, err
	}
	var changed, removed []string
	for root, fingerprint := range now {
		// A module the go command was interrupted extracting (or is told it was) will be
		// extracted again, from its zip, which the go command doesn't check.
		if old[root].fingerprint != fingerprint || extracting(modcache, root) {
			changed = append(changed, root)
		}
	}
	for root := range old {
		if _, ok := now[root]; !ok {
			removed = append(removed, root)
		}
	}
	if len(changed) > 0 {
		if existed {
			fmt.Fprintf(out, "modcache-check: hashing %d changed module(s)\n", len(changed))
		} else {
			fmt.Fprintf(out, "modcache-check: no fingerprints yet, so hashing all %d module(s) once\n", len(changed))
		}
	}
	results := verifyAll(modcache, changed, removed)

	next := state{}
	for root, fingerprint := range now {
		if r, ok := results[root]; ok && (r.problem != "" || r.unverified) {
			continue // never recorded, so it's hashed again next time
		}
		next[root] = entry{fingerprint: fingerprint, lastUsed: old[root].lastUsed}
	}
	for _, r := range results {
		if r.problem != "" {
			problems = append(problems, r.problem)
		}
	}
	if len(problems) > 0 {
		slices.Sort(problems)
		return problems, nil
	}
	return nil, saveState(stateFile, next)
}

// scan fingerprints every module directory in the cache (keyed by its escaped path relative
// to the cache, as in github.com/!burnt!sushi/toml@v1.6.0). A file outside any module's
// directory is a problem: the go command never writes one.
func scan(modcache string) (map[string]string, []string, error) {
	type file struct{ root, line string }
	var files []file
	// On Windows a stamp takes a few system calls, so they're read several at a time, while
	// the walk goes on.
	type job struct {
		i    int
		path string
		info fs.FileInfo
	}
	jobs := make(chan job, 256)
	stamps := map[int]string{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range 16 {
		wg.Go(func() {
			for j := range jobs {
				stamp := sysStamp(j.path, j.info)
				mu.Lock()
				stamps[j.i] = stamp
				mu.Unlock()
			}
		})
	}
	var problems []string
	err := filepath.WalkDir(modcache, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil // no cache yet, or deleted while we walked it (by a prune running alongside)
			}
			return err
		}
		rel, err := filepath.Rel(modcache, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == "cache" {
				// Downloads: zips, which are checked below when they're about to be used,
				// and go.mod files, which the go command checks against go.sum each time.
				return filepath.SkipDir
			}
			return nil
		}
		root, inner, ok := splitRoot(rel)
		if !ok {
			problems = append(problems, rel+": a file outside any module's directory")
			return nil
		}
		info, err := d.Info()
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		} else if err != nil {
			return err
		}
		line := fmt.Sprintf("%s\x00%d\x00%d\x00%d", inner, info.Size(), info.ModTime().UnixNano(), info.Mode())
		files = append(files, file{root, line})
		jobs <- job{len(files) - 1, path, info}
		return nil
	})
	close(jobs)
	wg.Wait()
	if err != nil {
		return nil, nil, err
	}

	hashes := map[string]hash.Hash{}
	for i, f := range files { // in WalkDir's lexical order, so the same files always hash the same
		h := hashes[f.root]
		if h == nil {
			h = sha256.New()
			hashes[f.root] = h
		}
		fmt.Fprintf(h, "%s\x00%s\n", f.line, stamps[i])
	}
	fingerprints := make(map[string]string, len(hashes))
	for root, h := range hashes {
		fingerprints[root] = hex.EncodeToString(h.Sum(nil))
	}
	return fingerprints, problems, nil
}

// splitRoot splits a path in the cache into its module's directory, which ends at the first
// element with an @ (module paths have none), and the rest.
func splitRoot(rel string) (root, inner string, ok bool) {
	elems := strings.Split(rel, "/")
	for i, e := range elems {
		if strings.Contains(e, "@") {
			return strings.Join(elems[:i+1], "/"), strings.Join(elems[i+1:], "/"), true
		}
	}
	return "", "", false
}

type result struct {
	problem    string
	unverified bool // checked by its zip instead: hash its files again next time
}

// verifyAll checks the changed and removed modules, several at a time.
func verifyAll(modcache string, changed, removed []string) map[string]result {
	type job struct {
		root    string
		removed bool
	}
	jobs := make(chan job)
	results := map[string]result{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range runtime.GOMAXPROCS(0) {
		wg.Go(func() {
			for j := range jobs {
				r := verifyModule(modcache, j.root, j.removed)
				mu.Lock()
				results[j.root] = r
				mu.Unlock()
			}
		})
	}
	for _, root := range changed {
		jobs <- job{root, false}
	}
	for _, root := range removed {
		jobs <- job{root, true}
	}
	close(jobs)
	wg.Wait()
	return results
}

// verifyModule hashes a module's files and compares the hash with the one the go command
// recorded when it downloaded the module. When its directory is gone, or the go command is
// partway through extracting it, the zip it will be extracted from is checked instead.
func verifyModule(modcache, root string, removed bool) result {
	mod, err := parseRoot(root)
	if err != nil {
		return result{problem: fmt.Sprintf("%s: %v", root, err)}
	}
	download := mod.download(modcache)
	if extracting(modcache, root) {
		removed = true // the go command doesn't use a partly extracted module: it extracts it again
	}
	prefix := mod.path + "@" + mod.version
	if !removed {
		want, err := recordedHash(download, prefix)
		if err != nil {
			return result{problem: fmt.Sprintf("%s: no recorded hash to check its files against (%v)", root, err)}
		}
		dir := filepath.Join(modcache, filepath.FromSlash(root))
		got, err := hashDir(dir, prefix)
		if errors.Is(err, fs.ErrNotExist) {
			// Only a directory that's gone counts as deleted: a file that can't be opened
			// by the name it's listed under is a problem like any other.
			if _, statErr := os.Lstat(dir); errors.Is(statErr, fs.ErrNotExist) {
				return result{problem: checkZip(root, download, prefix), unverified: true}
			}
		}
		switch {
		case err != nil:
			return result{problem: fmt.Sprintf("%s: %v", root, err)}
		case got != want:
			return result{problem: fmt.Sprintf("%s: its files don't match the module's recorded hash (edited since it was downloaded?)", root)}
		default:
			return result{}
		}
	}
	return result{problem: checkZip(root, download, prefix), unverified: true}
}

// recordedHash is the hash the go command recorded for a module. It recreates a ziphash file
// that isn't a hash (cut short by an interrupted download, say) from the zip, so then the
// zip's hash is the one it checks against go.sum.
func recordedHash(download, prefix string) (string, error) {
	h, err := readZiphash(download + ".ziphash")
	if err != nil || validHash(h) {
		return h, err
	}
	return hashZip(download+".zip", prefix)
}

// validHash is the go command's test of a ziphash file (modfetch.isValidSum).
func validHash(h string) bool {
	return len(h) == len("h1:")+base64.StdEncoding.EncodedLen(sha256.Size) && !strings.Contains(h, "\x00")
}

// checkZip checks that a module's zip, which the go command extracts without checking it,
// matches the module's recorded hash, which the go command does check against go.sum. Without
// the zip or a valid hash, the go command downloads the module again or rehashes the zip.
func checkZip(root, download, prefix string) string {
	want, err := readZiphash(download + ".ziphash")
	if errors.Is(err, fs.ErrNotExist) || (err == nil && !validHash(want)) {
		return ""
	} else if err != nil {
		return fmt.Sprintf("%s: %v", root, err)
	}
	got, err := hashZip(download+".zip", prefix)
	if errors.Is(err, fs.ErrNotExist) {
		return ""
	} else if err != nil {
		return fmt.Sprintf("%s: %v", root, err)
	}
	if got != want {
		return fmt.Sprintf("%s: its zip doesn't match the module's recorded hash (edited since it was downloaded?)", root)
	}
	return ""
}

func readZiphash(file string) (string, error) {
	data, err := os.ReadFile(file)
	return strings.TrimSpace(string(data)), err
}

type module struct {
	path, version               string // as in go.mod: github.com/BurntSushi/toml, v1.6.0
	escapedPath, escapedVersion string // as in the cache: github.com/!burnt!sushi/toml, v1.6.0
}

// download is where the go command keeps the module's zip and recorded hash (this plus ".zip"
// and ".ziphash"), and marks the module as being extracted (".partial").
func (m module) download(modcache string) string {
	return filepath.Join(modcache, "cache", "download", filepath.FromSlash(m.escapedPath), "@v", m.escapedVersion)
}

// extracting reports whether the go command is extracting a module, or was interrupted
// extracting it.
func extracting(modcache, root string) bool {
	mod, err := parseRoot(root)
	if err != nil {
		return false
	}
	_, err = os.Stat(mod.download(modcache) + ".partial")
	return err == nil
}

// parseRoot splits a module directory's name at the @ in its last element (see splitRoot).
func parseRoot(root string) (module, error) {
	last := strings.LastIndex(root, "/") + 1
	at := strings.Index(root[last:], "@")
	if at < 0 {
		return module{}, errors.New("not a module directory's name")
	}
	at += last
	m := module{escapedPath: root[:at], escapedVersion: root[at+1:]}
	var err1, err2 error
	m.path, err1 = unescape(m.escapedPath)
	m.version, err2 = unescape(m.escapedVersion)
	if err := errors.Join(err1, err2); err != nil || m.path == "" || m.version == "" {
		return module{}, errors.New("not a module directory's name")
	}
	return m, nil
}

// unescape undoes the go command's escaping of capital letters in module paths and versions
// in the cache, where "!b" stands for "B" (golang.org/x/mod/module.UnescapePath).
func unescape(escaped string) (string, error) {
	var b strings.Builder
	bang := false
	for _, r := range escaped {
		switch {
		case r >= utf8.RuneSelf:
			return "", errors.New("non-ASCII")
		case bang:
			if r < 'a' || r > 'z' {
				return "", errors.New("bad escape")
			}
			b.WriteRune(r - 'a' + 'A')
			bang = false
		case r == '!':
			bang = true
		case 'A' <= r && r <= 'Z':
			return "", errors.New("unescaped capital")
		default:
			b.WriteRune(r)
		}
	}
	if bang {
		return "", errors.New("bad escape")
	}
	return b.String(), nil
}

// hashDir is golang.org/x/mod/sumdb/dirhash.HashDir with the Hash1 algorithm, which is what
// the go command records, except that anything but a regular file is an error: the go command
// only ever extracts regular files, and a link could point at a file that changes later.
func hashDir(dir, prefix string) (string, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == dir && !d.IsDir() {
			return fmt.Errorf("%s is not a directory", dir)
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("%s is not a regular file", filepath.ToSlash(rel))
		}
		files = append(files, prefix+"/"+filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return "", err
	}
	return hash1(files, func(name string) (io.ReadCloser, error) {
		return os.Open(filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(name, prefix+"/"))))
	})
}

// hashZip is golang.org/x/mod/sumdb/dirhash.HashZip with the Hash1 algorithm. Every file in
// a module's zip is under prefix (the module's path@version): one that isn't is an error, as
// the go command would refuse to extract it.
func hashZip(file, prefix string) (string, error) {
	z, err := zip.OpenReader(file)
	if err != nil {
		return "", err
	}
	defer z.Close()
	var files []string
	byName := map[string]*zip.File{}
	for _, f := range z.File {
		if !strings.HasPrefix(f.Name, prefix+"/") {
			return "", fmt.Errorf("its zip has a file outside the module: %s", f.Name)
		}
		files = append(files, f.Name)
		byName[f.Name] = f
	}
	return hash1(files, func(name string) (io.ReadCloser, error) { return byName[name].Open() })
}

// hash1 is golang.org/x/mod/sumdb/dirhash.Hash1: a SHA-256 of a sorted list of each file's
// SHA-256 and name, as "h1:" and base64.
func hash1(files []string, open func(string) (io.ReadCloser, error)) (string, error) {
	h := sha256.New()
	for _, file := range slices.Sorted(slices.Values(files)) {
		if strings.Contains(file, "\n") {
			return "", errors.New("a file name with a newline")
		}
		r, err := open(file)
		if err != nil {
			return "", err
		}
		hf := sha256.New()
		_, err = io.Copy(hf, r)
		r.Close()
		if err != nil {
			return "", err
		}
		fmt.Fprintf(h, "%x  %s\n", hf.Sum(nil), file)
	}
	return "h1:" + base64.StdEncoding.EncodeToString(h.Sum(nil)), nil
}

// prune deletes the modules nobody has used for keep (both the extracted files and the zip),
// and marks the ones in inUse as used now. A module first seen by this prune counts as used
// now. A module that can't be deleted (one being extracted, or a file held open by a virus
// scanner) is left for next time, with a warning.
func prune(modcache, stateFile string, inUse []string, keep time.Duration, now time.Time, warn io.Writer) error {
	st, existed, err := loadState(stateFile)
	if err != nil || !existed {
		return err // nothing has been checked yet
	}
	used := map[string]bool{}
	for _, dir := range inUse {
		rel, err := filepath.Rel(modcache, dir)
		if err == nil && filepath.IsLocal(rel) { // the main module isn't in the cache
			used[filepath.ToSlash(rel)] = true
		}
	}
	trashDir := filepath.Join(modcache, "cache", "modcache-check-trash")
	var trash string
	deleted := 0
	for _, root := range slices.Sorted(maps.Keys(st)) {
		e := st[root]
		if used[root] || e.lastUsed == 0 {
			e.lastUsed = now.Unix()
			st[root] = e
			continue
		}
		if now.Sub(time.Unix(e.lastUsed, 0)) < keep {
			continue
		}
		if trash == "" {
			if err := os.MkdirAll(trashDir, 0o777); err != nil {
				return err
			}
			if trash, err = os.MkdirTemp(trashDir, ""); err != nil {
				return err
			}
		}
		moved, err := removeModule(modcache, root, filepath.Join(trash, strconv.Itoa(deleted)))
		if err != nil {
			fmt.Fprintf(warn, "modcache-check: couldn't delete %s, which hasn't been used since %s: %v\n",
				root, time.Unix(e.lastUsed, 0).Format(time.DateOnly), err)
		}
		if moved {
			delete(st, root)
			deleted++
		}
	}
	if err := saveState(stateFile, st); err != nil {
		return err
	}
	if trash != "" {
		if err := removeAll(trash); err != nil {
			fmt.Fprintf(warn, "modcache-check: couldn't empty %s: %v\n", trash, err)
		}
	}
	// Earlier prunes' leftovers (files a virus scanner held open may be deletable now), but
	// not a prune running alongside this one.
	leftovers, _ := os.ReadDir(trashDir)
	for _, d := range leftovers {
		if info, err := d.Info(); err == nil && now.Sub(info.ModTime()) > time.Hour {
			removeAll(filepath.Join(trashDir, d.Name()))
		}
	}
	return nil
}

// removeModule moves a module's directory to trash in one step, so the go command never sees
// it half deleted, then deletes its zip and recorded hash. moved reports whether the directory
// is gone from the cache, even if deleting the zip then failed.
func removeModule(modcache, root, trash string) (moved bool, err error) {
	mod, err := parseRoot(root)
	if err != nil {
		return false, err
	}
	if extracting(modcache, root) {
		return false, errors.New("the go command is extracting it")
	}
	dir := filepath.Join(modcache, filepath.FromSlash(root))
	// The go command makes module directories read-only, and on Linux moving a directory
	// needs write permission on it.
	if err := os.Chmod(dir, 0o777); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	if err := os.Rename(dir, trash); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	download := mod.download(modcache)
	for _, ext := range []string{".zip", ".ziphash"} {
		if err := os.Remove(download + ext); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return true, err
		}
	}
	return true, nil
}

// removeAll is os.RemoveAll for a tree with read-only directories, which the go command makes.
func removeAll(dir string) error {
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			os.Chmod(path, 0o777)
		}
		return nil
	})
	return os.RemoveAll(dir)
}

// The state file: a header, then a line for each module directory that checked out, with its
// fingerprint and when it was last used (Unix seconds; 0 until a prune sees it).
type state map[string]entry

type entry struct {
	fingerprint string
	lastUsed    int64
}

const stateHeader = "modcache-check state 1"

func loadState(file string) (st state, existed bool, err error) {
	data, err := os.ReadFile(file)
	if errors.Is(err, fs.ErrNotExist) {
		return state{}, false, nil
	} else if err != nil {
		return nil, false, err
	}
	st, err = parseState(data, file)
	return st, err == nil, err
}

func parseState(data []byte, name string) (state, error) {
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if lines[0] != stateHeader {
		return nil, fmt.Errorf("%s isn't a state file this version understands", name)
	}
	st := state{}
	for _, line := range lines[1:] {
		f := strings.Split(line, "\t")
		var lastUsed int64
		var err error
		if len(f) == 3 {
			lastUsed, err = strconv.ParseInt(f[2], 10, 64)
		}
		if len(f) != 3 || err != nil {
			return nil, fmt.Errorf("%s has a malformed line: %q", name, line)
		}
		st[f[0]] = entry{fingerprint: f[1], lastUsed: lastUsed}
	}
	return st, nil
}

// saveState replaces the state file in one step, so a crash or a second hook running at the
// same time never leaves half of one. On Windows the replacing fails while another process has
// the file open, so it's tried for a few seconds.
func saveState(file string, st state) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o777); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), filepath.Base(file)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	w := bufio.NewWriter(tmp)
	fmt.Fprintln(w, stateHeader)
	for _, root := range slices.Sorted(maps.Keys(st)) {
		fmt.Fprintf(w, "%s\t%s\t%d\n", root, st[root].fingerprint, st[root].lastUsed)
	}
	err = errors.Join(w.Flush(), tmp.Close())
	if err != nil {
		return err
	}
	for range 50 {
		if err = os.Rename(tmp.Name(), file); err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return err
}
