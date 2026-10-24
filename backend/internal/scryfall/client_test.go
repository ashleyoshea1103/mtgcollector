package scryfall

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// gzipLines gzips the given lines, as Scryfall serves its JSON Lines bulk files.
func gzipLines(t *testing.T, lines ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(strings.Join(lines, "\n") + "\n")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// fakeScryfall serves routes on an httptest server and records the requests' headers.
func fakeScryfall(t *testing.T, routes map[string]func(w http.ResponseWriter, r *http.Request)) (*Client, *[]http.Header) {
	t.Helper()
	var headers []http.Header
	mux := http.NewServeMux()
	for path, h := range routes {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			headers = append(headers, r.Header.Clone())
			h(w, r)
		})
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return NewForTest(srv.URL), &headers
}

func TestDefaultCardsReadsTheBulkFileLink(t *testing.T) {
	var srvURL string
	c, headers := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /bulk-data/default-cards": func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, `{"object":"bulk_data","updated_at":"2026-10-07T09:05:47.951+00:00",
				"jsonl_download_uri":"%s/default-cards/x.jsonl.gz","compressed_size":10}`, srvURL)
		},
	})
	srvURL = c.baseURL

	f, err := c.DefaultCards(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if f.DownloadURI != srvURL+"/default-cards/x.jsonl.gz" {
		t.Errorf("DownloadURI = %q", f.DownloadURI)
	}
	if want := time.Date(2026, 10, 7, 9, 5, 47, 951_000_000, time.UTC); !f.UpdatedAt.Equal(want) {
		t.Errorf("UpdatedAt = %v, want %v", f.UpdatedAt, want)
	}
	// Scryfall requires both headers on every request.
	h := (*headers)[0]
	if !strings.HasPrefix(h.Get("User-Agent"), "mtgcollector/") || h.Get("Accept") != "application/json" {
		t.Errorf("User-Agent %q, Accept %q", h.Get("User-Agent"), h.Get("Accept"))
	}
}

func TestDefaultCardsRefusesALinkOffScryfall(t *testing.T) {
	for _, link := range []string{
		"https://evil.example/default-cards.jsonl.gz",
		"https://user:pw@HOST/default-cards.jsonl.gz",
		"",
	} {
		var srvURL string
		c, _ := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
			"GET /bulk-data/default-cards": func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"updated_at":"2026-10-07T09:05:47Z","jsonl_download_uri":%q}`,
					strings.Replace(link, "HOST", strings.TrimPrefix(srvURL, "http://"), 1))
			},
		})
		srvURL = c.baseURL
		if _, err := c.DefaultCards(t.Context()); err == nil {
			t.Errorf("link %q was accepted", link)
		}
	}
}

func TestSetsFollowsPagesOnScryfallOnly(t *testing.T) {
	var srvURL string
	c, _ := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /sets": func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, `{"data":[{"code":"m10"}],"has_more":true,"next_page":"%s/sets/2"}`, srvURL)
		},
		"GET /sets/2": func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, `{"data":[{"code":"mh2"}],"has_more":true,"next_page":"https://evil.example/sets/3"}`)
		},
	})
	srvURL = c.baseURL

	if _, err := c.Sets(t.Context()); err == nil || !strings.Contains(err.Error(), "evil.example") {
		t.Errorf("Sets() error = %v, want the off-site next page refused", err)
	}
}

func TestSetsReadsEveryPage(t *testing.T) {
	var srvURL string
	c, _ := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /sets": func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, `{"data":[{"code":"m10"}],"has_more":true,"next_page":"%s/sets/2"}`, srvURL)
		},
		"GET /sets/2": func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, `{"data":[{"code":"mh2"}],"has_more":false}`)
		},
	})
	srvURL = c.baseURL

	sets, err := c.Sets(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(sets) != 2 || sets[0].Code != "m10" || sets[1].Code != "mh2" {
		t.Errorf("Sets() = %+v", sets)
	}
}

func bulkClient(t *testing.T, body []byte) (*Client, BulkFile) {
	t.Helper()
	c, _ := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /default-cards.jsonl.gz": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/gzip")
			w.Write(body)
		},
	})
	return c, BulkFile{DownloadURI: c.baseURL + "/default-cards.jsonl.gz"}
}

func collect(t *testing.T, c *Client, f BulkFile) ([]string, error) {
	t.Helper()
	var names []string
	err := c.EachCard(t.Context(), f, func(card Card) error {
		names = append(names, card.Name)
		return nil
	}, func(line int, err error) {
		names = append(names, fmt.Sprintf("bad line %d", line))
	})
	return names, err
}

func TestEachCardReadsEveryLine(t *testing.T) {
	c, f := bulkClient(t, gzipLines(t, `{"name":"Lightning Bolt"}`, ``, `{"name":"Llanowar Elves"}`))
	names, err := collect(t, c, f)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "Lightning Bolt,Llanowar Elves" {
		t.Errorf("names = %v", names)
	}
}

func TestEachCardFailsOnABrokenFile(t *testing.T) {
	whole := gzipLines(t, `{"name":"Lightning Bolt"}`, `{"name":"Llanowar Elves"}`)
	corrupt := bytes.Clone(whole)
	corrupt[len(corrupt)-6] ^= 0xff // inside the CRC-32 trailer
	for name, body := range map[string][]byte{
		"truncated download": whole[:len(whole)-10],
		"bad checksum":       corrupt,
		"not gzip":           []byte(`{"name":"Lightning Bolt"}`),
		"line too long":      gzipLines(t, `{"name":"`+strings.Repeat("x", maxCard)+`"}`),
	} {
		t.Run(name, func(t *testing.T) {
			c, f := bulkClient(t, body)
			if _, err := collect(t, c, f); err == nil {
				t.Error("EachCard succeeded")
			}
		})
	}
}

// A card Scryfall's way that doesn't decode (a changed field type, say) is reported, and
// the rest of the file is still read.
func TestEachCardReportsBadLinesAndCarriesOn(t *testing.T) {
	c, f := bulkClient(t, gzipLines(t, `{"name":"a"}`, `{"name":"b","cmc":"three"}`, `{"name":`, `{"name":"c"}`))
	names, err := collect(t, c, f)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names, ","); got != "a,bad line 2,bad line 3,c" {
		t.Errorf("got %s", got)
	}
}

// gzip allows a file made of several compressed members (parallel compressors write them);
// every member must be read, not just the first.
func TestEachCardReadsEveryGzipMember(t *testing.T) {
	body := append(gzipLines(t, `{"name":"a"}`), gzipLines(t, `{"name":"b"}`)...)
	c, f := bulkClient(t, body)
	names, err := collect(t, c, f)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names, ",") != "a,b" {
		t.Errorf("names = %v, want both members' cards", names)
	}
}

func TestEachCardStopsAtTheCallbacksError(t *testing.T) {
	c, f := bulkClient(t, gzipLines(t, `{"name":"a"}`, `{"name":"b"}`, `{"name":"c"}`))
	stop := errors.New("stop")
	calls := 0
	err := c.EachCard(t.Context(), f, func(Card) error {
		calls++
		return stop
	}, func(int, error) {})
	if !errors.Is(err, stop) || calls != 1 {
		t.Errorf("err = %v after %d calls, want stop after 1", err, calls)
	}
}

func TestErrorsAndRedirects(t *testing.T) {
	c, _ := fakeScryfall(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /bulk-data/default-cards": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "busy", http.StatusTooManyRequests)
		},
		"GET /sets": func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://evil.example/sets", http.StatusFound)
		},
	})
	if _, err := c.DefaultCards(t.Context()); err == nil || !strings.Contains(err.Error(), "429") {
		t.Errorf("DefaultCards() error = %v, want the 429", err)
	}
	if _, err := c.Sets(t.Context()); err == nil || !strings.Contains(err.Error(), "redirect") {
		t.Errorf("Sets() error = %v, want the off-site redirect refused", err)
	}
}

func TestEachCardHonoursCancellation(t *testing.T) {
	c, f := bulkClient(t, gzipLines(t, `{"name":"a"}`))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := c.EachCard(ctx, f, func(Card) error { return nil }, func(int, error) {}); err == nil {
		t.Error("EachCard ran with a cancelled context")
	}
}

func TestCheckURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://cards.scryfall.io/small/front/x.jpg?1": true,
		"http://cards.scryfall.io/small/front/x.jpg":    false,
		"https://cards.scryfall.io.evil.example/x.jpg":  false,
		"https://evil.example/cards.scryfall.io/x.jpg":  false,
		"https://u:p@cards.scryfall.io/x.jpg":           false,
		"https://cards.scryfall.io:444/x.jpg":           false,
		"//cards.scryfall.io/x.jpg":                     false,
		"cards.scryfall.io/x.jpg":                       false,
		"":                                              false,
	} {
		if got := CheckURL(raw, ImageHost) == nil; got != ok {
			t.Errorf("CheckURL(%q) ok = %v, want %v", raw, got, ok)
		}
	}
}

// URLs that would be dangerous anywhere other than a plain link (in a CSS url(), an
// attribute built by hand, a log line) are refused, even on the right host.
func TestCheckURLRefusesUnsafeCharacters(t *testing.T) {
	for _, raw := range []string{
		`https://cards.scryfall.io/x'),url('https://evil.example/`,
		`https://cards.scryfall.io/x"onerror="alert(1).jpg`,
		`https://cards.scryfall.io/<script>`,
		"https://cards.scryfall.io/x" + string(rune(0x202e)) + ".jpg", // right-to-left override
		`https://cards.scryfall.io/a b.jpg`,
		`https://cards.scryfall.io/x.jpg#frag`,
		`https://cards.scryfall.io\@evil.example/x.jpg`,
		`HTTPS://cards.scryfall.io/x.jpg`,
		`https://cards.scryfall.io./x.jpg`,
	} {
		if CheckURL(raw, ImageHost) == nil {
			t.Errorf("CheckURL(%q) accepted it", raw)
		}
	}
	// What real Scryfall data looks like is accepted.
	for raw, host := range map[string]string{
		"https://cards.scryfall.io/normal/front/3/e/3e3f0bcd-0796-494d-bf51-94b33c1671e9.jpg?1783923536":                             ImageHost,
		"https://svgs.scryfall.io/sets/mh2.svg?1783000000":                                                                           SetIconHost,
		"https://www.cardmarket.com/en/Magic/Products/Search?referrer=scryfall&searchString=Lightning+Bolt&utm_campaign=card_prices": CardmarketHost,
	} {
		if err := CheckURL(raw, host); err != nil {
			t.Errorf("CheckURL(%q): %v", raw, err)
		}
	}
}
