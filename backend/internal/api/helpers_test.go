package api

import (
	"io"
	"log/slog"
	"sync"
	"testing"
)

// captureLogs sends the default logger's output to w until the test ends. The tests in this
// package don't run in parallel, so swapping the default is safe.
func captureLogs(t *testing.T, w io.Writer) {
	t.Helper()
	old := slog.Default()
	var mu sync.Mutex
	slog.SetDefault(slog.New(slog.NewTextHandler(lockedWriter{&mu, w}, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
}

type lockedWriter struct {
	mu *sync.Mutex
	w  io.Writer
}

func (l lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
