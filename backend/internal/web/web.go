// Package web is the whole site: the API under /api/, the built frontend (frontend/dist)
// everywhere else, and the checks every request goes through first.
package web

import (
	"errors"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
)

// The frontend's Content-Security-Policy. Scripts, styles and fonts come from the site
// itself, with nothing inline, except two small <style> elements React Aria adds (allowed by
// their hash; frontend/src/ui/cspStyles.test.tsx checks the hashes still match): one makes
// pressable elements scroll and zoom without delay, the other stops a page scrolling behind a
// dialog on iPhones and iPads. Images (card scans, and the mana and set symbols, which are
// SVGs drawn only as <img> or CSS masks) come from Scryfall's two image hosts. The app talks
// only to its own API, can't be framed, and has no plugins, <base> or off-site form posts.
const ContentSecurityPolicy = "default-src 'self'; script-src 'self'; " +
	"style-src 'self' " + reactAriaStyleHashes + "; font-src 'self'; " +
	"img-src 'self' https://cards.scryfall.io https://svgs.scryfall.io; connect-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

const reactAriaStyleHashes = "'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' " + // usePress
	"'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='" // usePreventScroll, on iOS

// New serves api under /api/ and, if static isn't nil, the built frontend in it everywhere
// else. Without static (in development, where Vite serves the frontend) other paths are 404s.
func New(api http.Handler, static fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	if static != nil {
		mux.Handle("/", frontend(static))
	}
	return mux
}

// frontend serves the files in static. A path with no file is a page of the app (its router
// shows it), so it gets index.html; but a missing file under assets/ is a 404, not a page,
// since what asked for it wanted a script or a stylesheet.
func frontend(static fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h := w.Header()
		h.Set("Content-Security-Policy", ContentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		// No page, image or link sends the app's URLs anywhere, even where a component
		// forgets its own referrerpolicy.
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" && serveFile(w, r, static, name) {
			return
		}
		if strings.HasPrefix(name, "assets/") {
			h.Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		h.Set("Cache-Control", "no-cache") // always checked, so a new release shows at once
		if !serveFile(w, r, static, "index.html") {
			http.Error(w, "the frontend isn't built", http.StatusNotFound)
		}
	})
}

// serveFile serves the regular file name from static, if there is one.
func serveFile(w http.ResponseWriter, r *http.Request, static fs.FS, name string) bool {
	f, err := static.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	content, ok := f.(interface {
		Read([]byte) (int, error)
		Seek(int64, int) (int64, error)
	})
	if !ok {
		return false
	}
	if strings.HasPrefix(name, "assets/") {
		// Vite names these by their content's hash, so a file's content never changes.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if name != "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), content)
	return true
}

// AllowHosts refuses requests whose Host isn't one of hosts (names, without ports). A site
// on another name can't then point its DNS at this server and have browsers treat the app
// as its own (DNS rebinding).
func AllowHosts(hosts []string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, h := range hosts {
		allowed[normalizeHost(h)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if !allowed[normalizeHost(host)] {
			http.Error(w, "unknown host", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func normalizeHost(h string) string {
	return strings.TrimSuffix(strings.ToLower(strings.Trim(h, "[]")), ".")
}

// ParseHosts reads a comma-separated list of host names, like "example.com,www.example.com".
func ParseHosts(s string) ([]string, error) {
	var hosts []string
	for h := range strings.SplitSeq(s, ",") {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		if strings.ContainsAny(h, "/:@ ") && net.ParseIP(strings.Trim(h, "[]")) == nil {
			return nil, errors.New("hosts are names without a scheme, port or path, like example.com: got " + h)
		}
		hosts = append(hosts, h)
	}
	if len(hosts) == 0 {
		return nil, errors.New("no hosts given")
	}
	return hosts, nil
}
