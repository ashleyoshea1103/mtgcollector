package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
)

const indexHTML = `<!doctype html><title>mtgcollector</title>`

func dist() fstest.MapFS {
	return fstest.MapFS{
		"index.html":            {Data: []byte(indexHTML)},
		"favicon.svg":           {Data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		"assets/index-abc1.js":  {Data: []byte(`console.log(1)`)},
		"assets/index-abc1.css": {Data: []byte(`body{}`)},
	}
}

var api = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-From", "api")
	io.WriteString(w, "api "+r.URL.Path)
})

func do(t *testing.T, h http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestAPIPathsGoToTheAPI(t *testing.T) {
	for _, p := range []string{"/api/health", "/api/cards/search?q=bolt", "/api/nope"} {
		rec := do(t, New(api, dist()), http.MethodGet, p)
		if rec.Header().Get("X-From") != "api" {
			t.Errorf("%s didn't reach the API: %d %q", p, rec.Code, rec.Body)
		}
	}
}

func TestFilesAreServedWithTheirTypeAndCaching(t *testing.T) {
	for _, tc := range []struct{ path, body, contentType, cache string }{
		{"/assets/index-abc1.js", "console.log(1)", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"},
		{"/assets/index-abc1.css", "body{}", "text/css; charset=utf-8", "public, max-age=31536000, immutable"},
		{"/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`, "image/svg+xml", "no-cache"},
		{"/", indexHTML, "text/html; charset=utf-8", "no-cache"},
		{"/index.html", indexHTML, "text/html; charset=utf-8", "no-cache"},
	} {
		rec := do(t, New(api, dist()), http.MethodGet, tc.path)
		if rec.Code != http.StatusOK || rec.Body.String() != tc.body {
			t.Errorf("%s = %d %q, want 200 %q", tc.path, rec.Code, rec.Body, tc.body)
		}
		if got := rec.Header().Get("Content-Type"); got != tc.contentType {
			t.Errorf("%s: Content-Type = %q, want %q", tc.path, got, tc.contentType)
		}
		if got := rec.Header().Get("Cache-Control"); got != tc.cache {
			t.Errorf("%s: Cache-Control = %q, want %q", tc.path, got, tc.cache)
		}
	}
}

func TestAppPagesGetIndexHTML(t *testing.T) {
	for _, p := range []string{"/collection", "/cards/0b8fe8b3-0000-4000-8000-000000000000", "/groups/7?view=list", "/assets"} {
		rec := do(t, New(api, dist()), http.MethodGet, p)
		if rec.Code != http.StatusOK || rec.Body.String() != indexHTML || rec.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s = %d %q (Cache-Control %q), want index.html, not cached", p, rec.Code, rec.Body, rec.Header().Get("Cache-Control"))
		}
	}
}

func TestAMissingAssetIsA404NotThePage(t *testing.T) {
	rec := do(t, New(api, dist()), http.MethodGet, "/assets/index-old9.js")
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "<title>") {
		t.Errorf("= %d %q, want a 404", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store: the file may appear with the next release", rec.Header().Get("Cache-Control"))
	}
}

func TestEveryFrontendResponseGetsTheSecurityHeaders(t *testing.T) {
	want := map[string]string{
		"Content-Security-Policy":      ContentSecurityPolicy,
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Resource-Policy": "same-origin",
	}
	for _, p := range []string{"/", "/collection", "/assets/index-abc1.js", "/assets/missing.js", "/favicon.svg"} {
		rec := do(t, New(api, dist()), http.MethodGet, p)
		for k, v := range want {
			if got := rec.Header().Get(k); got != v {
				t.Errorf("%s: %s = %q, want %q", p, k, got, v)
			}
		}
	}
}

func TestTheCSPAllowsNoInlineOrForeignScriptsAndOnlyScryfallImages(t *testing.T) {
	directives := map[string]string{}
	for d := range strings.SplitSeq(ContentSecurityPolicy, ";") {
		name, value, _ := strings.Cut(strings.TrimSpace(d), " ")
		directives[name] = value
	}
	for name, want := range map[string]string{
		"default-src":     "'self'",
		"script-src":      "'self'",
		"style-src":       "'self' " + reactAriaStyleHashes,
		"img-src":         "'self' https://cards.scryfall.io https://svgs.scryfall.io",
		"connect-src":     "'self'",
		"object-src":      "'none'",
		"base-uri":        "'none'",
		"frame-ancestors": "'none'",
	} {
		if directives[name] != want {
			t.Errorf("%s = %q, want %q", name, directives[name], want)
		}
	}
	if strings.Contains(ContentSecurityPolicy, "unsafe") || strings.Contains(ContentSecurityPolicy, "data:") || strings.Contains(ContentSecurityPolicy, "*") {
		t.Errorf("the CSP allows something unsafe: %s", ContentSecurityPolicy)
	}
}

// The real index.html must work under the CSP: no inline scripts or styles.
func TestTheFrontendsIndexHTMLHasNothingInline(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	html := strings.ToLower(string(src))
	for _, tag := range strings.Split(html, "<script")[1:] {
		if !strings.Contains(tag[:strings.Index(tag, ">")], "src=") {
			t.Errorf("index.html has an inline script: <script%s", tag[:strings.Index(tag, ">")+1])
		}
	}
	for _, inline := range []string{"<style", " style=", " onload=", " onerror=", " onclick=", "javascript:"} {
		if strings.Contains(html, inline) {
			t.Errorf("index.html has %q, which the CSP blocks", inline)
		}
	}
}

func TestOnlyGETAndHEADReachTheFrontend(t *testing.T) {
	if rec := do(t, New(api, dist()), http.MethodHead, "/"); rec.Code != http.StatusOK {
		t.Errorf("HEAD / = %d", rec.Code)
	}
	rec := do(t, New(api, dist()), http.MethodPost, "/collection")
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("POST /collection = %d, Allow %q; want 405", rec.Code, rec.Header().Get("Allow"))
	}
}

func TestWithoutAFrontendOnlyTheAPIIsServed(t *testing.T) {
	if rec := do(t, New(api, nil), http.MethodGet, "/"); rec.Code != http.StatusNotFound {
		t.Errorf("GET / = %d, want 404", rec.Code)
	}
	if rec := do(t, New(api, nil), http.MethodGet, "/api/health"); rec.Header().Get("X-From") != "api" {
		t.Error("the API wasn't served")
	}
}

func TestAnUnbuiltFrontendSaysSo(t *testing.T) {
	rec := do(t, New(api, fstest.MapFS{}), http.MethodGet, "/")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "isn't built") {
		t.Errorf("= %d %q", rec.Code, rec.Body)
	}
}

// Through os.Root, as the server opens it: a path can't leave the directory, by .. or by a
// symbolic link.
func TestFilesOutsideTheFrontendDirectoryCantBeReached(t *testing.T) {
	dir := t.TempDir()
	distDir := filepath.Join(dir, "dist")
	must(t, os.MkdirAll(filepath.Join(distDir, "assets"), 0o755))
	must(t, os.WriteFile(filepath.Join(distDir, "index.html"), []byte(indexHTML), 0o644))
	must(t, os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("TOP-SECRET-CONTENT"), 0o644))
	if runtime.GOOS != "windows" { // creating links needs extra rights on Windows
		must(t, os.Symlink(filepath.Join(dir, "secret.txt"), filepath.Join(distDir, "assets", "link.txt")))
	}
	root, err := os.OpenRoot(distDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })

	for _, p := range []string{"/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/assets/link.txt", "/..%5csecret.txt"} {
		rec := do(t, New(api, root.FS()), http.MethodGet, p)
		if strings.Contains(rec.Body.String(), "TOP-SECRET-CONTENT") {
			t.Errorf("%s reached a file outside the directory", p)
		}
	}
}

// A directory, opened through os.Root as the server does, is never served as a file: a
// path naming one is a page of the app.
func TestADirectoryIsntServed(t *testing.T) {
	dir := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(dir, "assets", "fonts"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte(indexHTML), 0o644))
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	for _, p := range []string{"/assets", "/assets/fonts"} {
		rec := do(t, New(api, root.FS()), http.MethodGet, p)
		if rec.Code == http.StatusOK && rec.Body.String() != indexHTML {
			t.Errorf("%s = %d %q: served the directory", p, rec.Code, rec.Body)
		}
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestOnlyAllowedHostsAreServed(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	h := AllowHosts([]string{"localhost", "127.0.0.1", "::1", "Collection.Example.com"}, ok)
	for host, want := range map[string]int{
		"localhost:5173":              200,
		"LOCALHOST":                   200,
		"127.0.0.1:8080":              200,
		"[::1]:8080":                  200,
		"collection.example.com":      200,
		"collection.example.com.":     200,
		"evil.example":                421,
		"evil.example:8080":           421,
		"localhost.evil.example":      421,
		"collection.example.com.evil": 421,
		"":                            421,
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q = %d, want %d", host, rec.Code, want)
		}
	}
}

func TestParseHosts(t *testing.T) {
	hosts, err := ParseHosts(" example.com, www.example.com ,,::1")
	if err != nil || strings.Join(hosts, "|") != "example.com|www.example.com|::1" {
		t.Errorf("= %v, %v", hosts, err)
	}
	for _, bad := range []string{"", " , ", "https://example.com", "example.com:8080", "example.com/app", "a b"} {
		if _, err := ParseHosts(bad); err == nil {
			t.Errorf("ParseHosts(%q) accepted it", bad)
		}
	}
}
