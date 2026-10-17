//go:build linux || darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestALinkInAModuleIsCaught(t *testing.T) {
	modcache, stateFile := t.TempDir(), filepath.Join(t.TempDir(), "state")
	addFixtures(t, modcache)
	checkOK(t, modcache, stateFile)
	dir := filepath.Join(modcache, "example.com", "m@v1.0.0")
	target := filepath.Join(t.TempDir(), "m.go")
	writeFile(t, target, "package m\n") // the same content, for now
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "m.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "m.go")); err != nil {
		t.Fatal(err)
	}
	wantProblem(t, modcache, stateFile, "example.com/m@v1.0.0: m.go is not a regular file")
}
