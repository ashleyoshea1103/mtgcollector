package main

import (
	"archive/zip"
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// Hashes golang.org/x/mod/sumdb/dirhash gives these modules, which is what the go command
// records when it downloads one.
var fixtures = []struct {
	root, hash string
	files      map[string]string
}{
	{"example.com/m@v1.0.0", "h1:fCHMqo5ggHEQvwcrsN81zr5orRk5lClR36KRHpfUjKg=",
		map[string]string{"go.mod": "module example.com/m\n", "m.go": "package m\n"}},
	{"example.com/m@v1.1.0", "h1:nxTBtmuhkRBEbWSZH1oQJztHCcumWqAnLXnua+afY3Y=",
		map[string]string{"go.mod": "module example.com/m\n", "m.go": "package m\n"}},
	{"example.com/!upper@v1.0.0", "h1:WCIo546KgyDq4eI31bUQVxGUUFDLHQQVwJlDrO/KCuY=",
		map[string]string{"go.mod": "module example.com/Upper\n", "sub/u.go": "package sub\n"}},
}

func TestHashesMatchTheOnesTheGoCommandRecords(t *testing.T) {
	for _, f := range fixtures {
		modcache := t.TempDir()
		addModule(t, modcache, f.root, f.files)
		mod, err := parseRoot(f.root)
		if err != nil {
			t.Fatal(err)
		}
		prefix := mod.path + "@" + mod.version
		if got, err := hashDir(filepath.Join(modcache, filepath.FromSlash(f.root)), prefix); got != f.hash || err != nil {
			t.Errorf("hashDir(%s) = %s, %v; want %s", f.root, got, err, f.hash)
		}
		if got, err := hashZip(mod.download(modcache)+".zip", prefix); got != f.hash || err != nil {
			t.Errorf("hashZip(%s) = %s, %v; want %s", f.root, got, err, f.hash)
		}
	}
}

func TestAnUnchangedCacheIsHashedOnlyTheFirstTime(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)

	out := checkOK(t, modcache, stateFile)
	if !strings.Contains(out, "hashing all 3 module(s) once") {
		t.Errorf("first check said %q; want it to say it's hashing all 3 modules", out)
	}
	if out := checkOK(t, modcache, stateFile); out != "" {
		t.Errorf("second check said %q; want nothing hashed", out)
	}
}

func TestTheFirstCheckCatchesAnEditedModule(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	appendTo(t, filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go"), "func init() { panic(1) }\n")

	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its files don't match")
	if _, err := os.Stat(stateFile); !os.IsNotExist(err) {
		t.Errorf("a failed check saved fingerprints (stat: %v)", err)
	}
}

func TestAnEditedModuleIsCaughtUntilItIsPutRight(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	file := filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go")
	appendTo(t, file, "func init() { panic(1) }\n")

	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its files don't match")
	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its files don't match") // not recorded as good

	if err := os.WriteFile(file, []byte("package m\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	checkOK(t, modcache, stateFile)
}

func TestAnEditThatPutsTheModificationTimeBackIsCaught(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	file := filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	appendTo(t, file, "var x = 1\n")
	if err := os.Chtimes(file, time.Time{}, info.ModTime()); err != nil {
		t.Fatal(err)
	}
	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its files don't match")
}

func TestANewlyDownloadedModuleIsHashedAndRecorded(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addModule(t, modcache, fixtures[0].root, fixtures[0].files)
	checkOK(t, modcache, stateFile)

	addModule(t, modcache, fixtures[1].root, fixtures[1].files)
	if out := checkOK(t, modcache, stateFile); !strings.Contains(out, "hashing 1 changed module") {
		t.Errorf("check said %q; want it to hash the new module", out)
	}
	if out := checkOK(t, modcache, stateFile); out != "" {
		t.Errorf("check said %q; want the new module recorded, so nothing hashed", out)
	}
}

func TestANewModuleThatDoesntMatchItsRecordedHashIsCaught(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	checkOK(t, modcache, stateFile)
	addModule(t, modcache, fixtures[0].root, fixtures[0].files)
	mod, _ := parseRoot(fixtures[0].root)
	writeFile(t, mod.download(modcache)+".ziphash", fixtures[1].hash+"\n")

	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its files don't match")
}

func TestAModuleWithNoRecordedHashIsCaught(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	writeFile(t, filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go"), "package m\n")

	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: no recorded hash")
}

func TestAFileOutsideAnyModuleIsCaught(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	writeFile(t, filepath.Join(modcache, "example.com", "planted.go"), "package planted\n")

	wantProblem(t, modcache, stateFile, "example.com/planted.go: a file outside any module's directory")
}

func TestTheDownloadsFolderIsLeftToTheGoCommand(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	// The go command rewrites lock and list files there as it pleases.
	writeFile(t, filepath.Join(modcache, "cache", "download", "example.com", "m", "@v", "list"), "v1.0.0\nv1.1.0\n")

	if out := checkOK(t, modcache, stateFile); out != "" {
		t.Errorf("check said %q; want nothing hashed", out)
	}
}

func TestAnEditHiddenByRewritingTheStateFileIsCaughtAgainstTheBaseline(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	baseline := readFile(t, stateFile)

	// What verified code could do: edit a module, then record its new fingerprint.
	appendTo(t, filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go"), "func init() { panic(1) }\n")
	fingerprints, _, err := scan(modcache)
	if err != nil {
		t.Fatal(err)
	}
	st, _, _ := loadState(stateFile)
	st["example.com/m@v1.0.0"] = entry{fingerprint: fingerprints["example.com/m@v1.0.0"]}
	if err := saveState(stateFile, st); err != nil {
		t.Fatal(err)
	}
	if problems, err := check(modcache, stateFile, nil, new(bytes.Buffer)); len(problems) > 0 || err != nil {
		t.Fatalf("against the rewritten file, check = %q, %v; the test expects it to be fooled", problems, err)
	}

	problems, err := check(modcache, stateFile, strings.NewReader(baseline), new(bytes.Buffer))
	if err != nil || !slices.ContainsFunc(problems, func(p string) bool { return strings.HasPrefix(p, "example.com/m@v1.0.0: its files don't match") }) {
		t.Errorf("against the baseline, check = %q, %v; want the edited module caught", problems, err)
	}
}

func TestTheBaselineIgnoresChangesAnotherPushMadeToTheStateFile(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addModule(t, modcache, fixtures[0].root, fixtures[0].files)
	checkOK(t, modcache, stateFile)
	baseline := readFile(t, stateFile)

	// Another push downloads a module, records it, and prunes (stamping the time it was used).
	addModule(t, modcache, fixtures[1].root, fixtures[1].files)
	checkOK(t, modcache, stateFile)
	mustPrune(t, modcache, stateFile, nil, time.Unix(1_800_000_000, 0))

	var out bytes.Buffer
	if problems, err := check(modcache, stateFile, strings.NewReader(baseline), &out); len(problems) > 0 || err != nil {
		t.Fatalf("check = %q, %v; want no problems", problems, err)
	}
	if !strings.Contains(out.String(), "hashing 1 changed module") {
		t.Errorf("check said %q; want the module new since the baseline hashed", out.String())
	}
	if st, _, _ := loadState(stateFile); st[fixtures[0].root].lastUsed != 1_800_000_000 {
		t.Errorf("last used = %d; want the other push's stamp kept", st[fixtures[0].root].lastUsed)
	}
}

func TestAMalformedModuleNameInTheStateFileIsAProblemNotACrash(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	writeFile(t, stateFile, stateHeader+"\nexample.com/m\tabc\t0\n")
	wantProblem(t, modcache, stateFile, "example.com/m: not a module directory's name")
}

func TestAZiphashCutShortIsRecreatedFromTheZipAsTheGoCommandWould(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	mod, _ := parseRoot(fixtures[0].root)
	writeFile(t, mod.download(modcache)+".ziphash", "h1:fCHMq")
	checkOK(t, modcache, stateFile)

	// ...so then the files must match the zip.
	writeZip(t, mod.download(modcache)+".zip", "example.com/m@v1.0.0", map[string]string{"go.mod": "module example.com/m\n", "m.go": "package evil\n"})
	wantProblem(t, modcache, filepath.Join(t.TempDir(), "state"), "example.com/m@v1.0.0: its files don't match")
}

func TestADeletedModuleIsCheckedByTheZipItWouldBeExtractedFrom(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	removeAll(filepath.Join(modcache, "example.com", "m@v1.0.0"))
	checkOK(t, modcache, stateFile)

	mod, _ := parseRoot("example.com/m@v1.1.0")
	removeAll(filepath.Join(modcache, "example.com", "m@v1.1.0"))
	writeZip(t, mod.download(modcache)+".zip", "example.com/m@v1.1.0", map[string]string{"go.mod": "module example.com/m\n", "m.go": "package evil\n"})
	wantProblem(t, modcache, stateFile, "example.com/m@v1.1.0: its zip doesn't match")
}

func TestAModuleBeingExtractedIsCheckedByItsZipAndHashedOnceExtracted(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	mod, _ := parseRoot("example.com/m@v1.0.0")
	partial := mod.download(modcache) + ".partial"
	writeFile(t, partial, "")
	dir := filepath.Join(modcache, "example.com", "m@v1.0.0")
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "m.go")); err != nil {
		t.Fatal(err)
	}
	checkOK(t, modcache, stateFile) // half extracted, but the zip checks out

	// Finished: the module is hashed, as it wasn't recorded while it was being extracted.
	writeFile(t, filepath.Join(dir, "m.go"), "package m\n")
	if err := os.Remove(partial); err != nil {
		t.Fatal(err)
	}
	if out := checkOK(t, modcache, stateFile); !strings.Contains(out, "hashing 1 changed module") {
		t.Errorf("check said %q; want the extracted module hashed", out)
	}
}

func TestAPartialMarkerOnAnUnchangedModuleGetsItsZipChecked(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	// The go command would extract this zip again over the unchanged files.
	mod, _ := parseRoot("example.com/m@v1.0.0")
	writeZip(t, mod.download(modcache)+".zip", "example.com/m@v1.0.0", map[string]string{"go.mod": "module example.com/m\n", "m.go": "package evil\n"})
	writeFile(t, mod.download(modcache)+".partial", "")

	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: its zip doesn't match")
}

func TestPruneDeletesModulesNotUsedForTheKeepPeriod(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	dirOf := func(root string) string { return filepath.Join(modcache, filepath.FromSlash(root)) }
	m100, m110, upper := fixtures[0].root, fixtures[1].root, fixtures[2].root
	day := 24 * time.Hour
	t0 := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

	mustPrune(t, modcache, stateFile, nil, t0)                                              // first seen: counts as used
	mustPrune(t, modcache, stateFile, []string{dirOf(m110)}, t0.Add(20*day))                // m110 used
	mustPrune(t, modcache, stateFile, []string{dirOf(upper), "/elsewhere"}, t0.Add(30*day)) // upper used

	for root, want := range map[string]bool{m100: false, m110: true, upper: true} {
		_, err := os.Stat(dirOf(root))
		mod, _ := parseRoot(root)
		_, zipErr := os.Stat(mod.download(modcache) + ".zip")
		if kept := err == nil && zipErr == nil; kept != want {
			t.Errorf("%s kept = %v (dir: %v, zip: %v), want %v", root, kept, err, zipErr, want)
		}
	}
	if trash, _ := os.ReadDir(filepath.Join(modcache, "cache", "modcache-check-trash")); len(trash) > 0 {
		t.Errorf("the trash wasn't emptied: %v", trash)
	}
	if out := checkOK(t, modcache, stateFile); out != "" {
		t.Errorf("check after pruning said %q; want nothing to hash", out)
	}

	mustPrune(t, modcache, stateFile, nil, t0.Add(51*day))
	if _, err := os.Stat(dirOf(m110)); !os.IsNotExist(err) {
		t.Errorf("%s, unused for 31 days, wasn't deleted (stat: %v)", m110, err)
	}
	if _, err := os.Stat(dirOf(upper)); err != nil {
		t.Errorf("%s, unused for 21 days, was deleted (stat: %v)", upper, err)
	}
}

func TestPruneLeavesAModuleBeingExtracted(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	t0 := time.Now()
	mustPrune(t, modcache, stateFile, nil, t0)
	mod, _ := parseRoot("example.com/m@v1.0.0")
	writeFile(t, mod.download(modcache)+".partial", "")

	var warn bytes.Buffer
	if err := prune(modcache, stateFile, nil, time.Hour, t0.Add(2*time.Hour), &warn); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(warn.String(), "couldn't delete example.com/m@v1.0.0") {
		t.Errorf("warnings = %q; want one about the module being extracted", warn.String())
	}
	if _, err := os.Stat(filepath.Join(modcache, "example.com", "m@v1.0.0")); err != nil {
		t.Errorf("the module being extracted was deleted (stat: %v)", err)
	}
	if _, err := os.Stat(filepath.Join(modcache, "example.com", "m@v1.1.0")); !os.IsNotExist(err) {
		t.Errorf("an unused module wasn't deleted (stat: %v)", err)
	}
}

func TestPruneBeforeAnyCheckDoesNothing(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	mustPrune(t, modcache, stateFile, nil, time.Now())
	if _, err := os.Stat(stateFile); !os.IsNotExist(err) {
		t.Errorf("prune wrote a state file with no fingerprints in it (stat: %v)", err)
	}
}

func TestAStateFileFromSomethingElseIsAnError(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	writeFile(t, stateFile, "something else\n")
	if _, err := check(modcache, stateFile, nil, new(bytes.Buffer)); err == nil {
		t.Error("check accepted a state file it didn't write")
	}
	writeFile(t, stateFile, stateHeader+"\nexample.com/m@v1.0.0\tabc\n")
	if _, err := check(modcache, stateFile, nil, new(bytes.Buffer)); err == nil {
		t.Error("check accepted a malformed line")
	}
}

func TestTheCommandLine(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	cases := []struct {
		args       []string
		stdin      string
		wantStatus int
		wantStderr string
	}{
		{nil, "", 2, "usage"},
		{[]string{"verify"}, "", 2, "usage"},
		{[]string{"check", modcache}, "", 2, "usage"},
		{[]string{"prune", "-keep", "soon", modcache, stateFile}, "", 2, "usage"},
		{[]string{"check", "-baseline", stateFile, modcache, stateFile}, "", 2, "usage"},
		{[]string{"check", "-baseline", "-", modcache, stateFile}, "not a state file\n", 2, "the baseline isn't a state file"},
		{[]string{"check", modcache, stateFile}, "", 0, ""},
		{[]string{"check", "-baseline", "-", modcache, stateFile}, stateHeader + "\n", 0, ""},
		{[]string{"prune", "-keep", "1h", modcache, stateFile}, filepath.Join(modcache, "example.com", "m@v1.0.0") + "\r\n\n", 0, ""},
	}
	for _, c := range cases {
		var stdout, stderr bytes.Buffer
		status := run(c.args, strings.NewReader(c.stdin), &stdout, &stderr)
		if status != c.wantStatus || !strings.Contains(stderr.String(), c.wantStderr) {
			t.Errorf("run(%q) = %d, stderr %q; want %d, stderr containing %q", c.args, status, stderr.String(), c.wantStatus, c.wantStderr)
		}
	}

	appendTo(t, filepath.Join(modcache, "example.com", "m@v1.0.0", "m.go"), "var x = 1\n")
	var stderr bytes.Buffer
	if status := run([]string{"check", modcache, stateFile}, nil, new(bytes.Buffer), &stderr); status != 1 ||
		!strings.Contains(stderr.String(), "modcache-check: example.com/m@v1.0.0: its files don't match") {
		t.Errorf("check of an edited module = %d, stderr %q; want 1 and the problem", status, stderr.String())
	}
}

func TestUnescape(t *testing.T) {
	for escaped, want := range map[string]string{
		"github.com/!burnt!sushi/toml": "github.com/BurntSushi/toml",
		"v1.0.0-!r!c1":                 "v1.0.0-RC1",
		"example.com/m":                "example.com/m",
		"example.com/Upper":            "",
		"example.com/!":                "",
		"example.com/!1":               "",
		"example.com/é":                "",
	} {
		got, err := unescape(escaped)
		if want == "" && err == nil {
			t.Errorf("unescape(%q) = %q; want an error", escaped, got)
		} else if want != "" && (got != want || err != nil) {
			t.Errorf("unescape(%q) = %q, %v; want %q", escaped, got, err, want)
		}
	}
}

// addModule puts a module in the cache the way the go command leaves one: its files read-only
// in read-only directories, and its zip and recorded hash under cache/download.
func addModule(t *testing.T, modcache, root string, files map[string]string) {
	t.Helper()
	mod, err := parseRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	prefix := mod.path + "@" + mod.version
	dir := filepath.Join(modcache, filepath.FromSlash(root))
	for name, body := range files {
		writeFile(t, filepath.Join(dir, filepath.FromSlash(name)), body)
	}
	writeZip(t, mod.download(modcache)+".zip", prefix, files)
	h, err := hashDir(dir, prefix)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, mod.download(modcache)+".ziphash", h+"\n")
	readOnly(t, dir)
}

func addFixtures(t *testing.T, modcache string) {
	for _, f := range fixtures {
		addModule(t, modcache, f.root, f.files)
	}
}

func readOnly(t *testing.T, dir string) {
	var dirs []string
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			t.Fatal(err)
		}
		if d.IsDir() {
			dirs = append(dirs, path)
		} else if err := os.Chmod(path, 0o444); err != nil {
			t.Fatal(err)
		}
		return nil
	})
	for _, d := range slices.Backward(dirs) {
		if err := os.Chmod(d, 0o555); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { removeAll(dir) }) // before t.TempDir's cleanup, which can't
}

func writeFile(t *testing.T, file, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o777); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, file string) string {
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func appendTo(t *testing.T, file, text string) {
	t.Helper()
	if err := os.Chmod(file, 0o644); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(text); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeZip(t *testing.T, file, prefix string, files map[string]string) {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := z.Create(prefix + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, buf.String())
}

// checkOK runs check, fails the test if it finds a problem, and returns what it said.
func checkOK(t *testing.T, modcache, stateFile string) string {
	t.Helper()
	var out bytes.Buffer
	problems, err := check(modcache, stateFile, nil, &out)
	if err != nil || len(problems) > 0 {
		t.Fatalf("check = %q, %v; want no problems", problems, err)
	}
	return out.String()
}

func wantProblem(t *testing.T, modcache, stateFile, want string) {
	t.Helper()
	problems, err := check(modcache, stateFile, nil, new(bytes.Buffer))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(problems, func(p string) bool { return strings.HasPrefix(p, want) }) {
		t.Errorf("check = %q; want a problem starting %q", problems, want)
	}
}

func mustPrune(t *testing.T, modcache, stateFile string, inUse []string, now time.Time) {
	t.Helper()
	var warn bytes.Buffer
	if err := prune(modcache, stateFile, inUse, 30*24*time.Hour, now, &warn); err != nil || warn.Len() > 0 {
		t.Fatalf("prune = %v, warnings %q", err, warn.String())
	}
}
