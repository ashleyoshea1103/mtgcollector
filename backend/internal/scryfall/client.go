// Package scryfall reads Scryfall's API and bulk data files (https://scryfall.com/docs/api).
//
// The app doesn't query Scryfall per request: internal/cards imports the daily bulk
// file into Postgres, using this package to fetch and decode it.
package scryfall

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Scryfall asks every client to identify itself and to accept JSON.
const userAgent = "mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)"

// Limits on what the client reads, so a broken or hostile response can't exhaust memory.
const (
	maxAPIResponse = 32 << 20 // API responses (metadata, the set list) are well under 1 MB
	maxBulkFile    = 4 << 30  // the default-cards file is about 80 MB gzipped, 500 MB unzipped
	maxCard        = 1 << 20  // one card object is a few KB
)

// Client calls Scryfall. The zero value is not usable; use New.
type Client struct {
	http    *http.Client
	baseURL string // the API, e.g. https://api.scryfall.com
	// Hosts that URLs taken from responses (the bulk file's download link, the next page of
	// sets) may point at. Anything else is refused rather than fetched.
	apiHost, bulkHost string
}

// New returns a client for Scryfall's real API.
func New() *Client {
	return newClient("https://api.scryfall.com", "api.scryfall.com", "data.scryfall.io")
}

// NewForTest returns a client for a fake Scryfall at baseURL (an httptest server), whose
// URLs are all on baseURL's host.
func NewForTest(baseURL string) *Client {
	u, err := url.Parse(baseURL)
	if err != nil {
		panic(err)
	}
	return newClient(baseURL, u.Host, u.Host)
}

func newClient(baseURL, apiHost, bulkHost string) *Client {
	c := &Client{baseURL: baseURL, apiHost: apiHost, bulkHost: bulkHost}
	c.http = &http.Client{
		Timeout: 30 * time.Minute, // the bulk download is large
		// Follow redirects only within Scryfall's own hosts.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if checkURL(req.URL.String(), c.apiHost) != nil && checkURL(req.URL.String(), c.bulkHost) != nil {
				return fmt.Errorf("redirect to %s refused", req.URL.Redacted())
			}
			return nil
		},
	}
	return c
}

// BulkFile describes one of Scryfall's bulk data files.
type BulkFile struct {
	// A gzipped JSON Lines file: one card object per line.
	DownloadURI string    `json:"jsonl_download_uri"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// DefaultCards describes the "default cards" bulk file: every printing, in English or
// in its only printed language.
func (c *Client) DefaultCards(ctx context.Context) (BulkFile, error) {
	var f BulkFile
	if err := c.getJSON(ctx, c.baseURL+"/bulk-data/default-cards", &f); err != nil {
		return BulkFile{}, fmt.Errorf("bulk data metadata: %w", err)
	}
	if err := checkURL(f.DownloadURI, c.bulkHost); err != nil {
		return BulkFile{}, fmt.Errorf("bulk data download link: %w", err)
	}
	return f, nil
}

// Sets returns every set Scryfall knows, following its pages.
func (c *Client) Sets(ctx context.Context) ([]Set, error) {
	var all []Set
	next := c.baseURL + "/sets"
	for page := 0; next != ""; page++ {
		if page == 100 {
			return nil, errors.New("sets: more than 100 pages")
		}
		var list struct {
			Data     []Set  `json:"data"`
			HasMore  bool   `json:"has_more"`
			NextPage string `json:"next_page"`
		}
		if err := c.getJSON(ctx, next, &list); err != nil {
			return nil, fmt.Errorf("sets: %w", err)
		}
		all = append(all, list.Data...)
		next = ""
		if list.HasMore {
			if err := checkURL(list.NextPage, c.apiHost); err != nil {
				return nil, fmt.Errorf("sets: next page link: %w", err)
			}
			next = list.NextPage
		}
	}
	return all, nil
}

// EachCard downloads the bulk file and calls fn with each card in it, decoding one card
// at a time so the file is never held in memory. It stops at the first error fn returns.
func (c *Client) EachCard(ctx context.Context, f BulkFile, fn func(Card) error) error {
	body, err := c.get(ctx, f.DownloadURI, "application/gzip")
	if err != nil {
		return fmt.Errorf("bulk file: %w", err)
	}
	defer body.Close()
	return decodeCards(&cappedReader{r: body, left: maxBulkFile}, fn)
}

// decodeCards reads a gzipped JSON Lines file of cards and calls fn with each one. gzip's
// checksum and length trailer make a truncated or corrupted download fail, rather than
// import only some of the cards.
func decodeCards(r io.Reader, fn func(Card) error) error {
	zr, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("bulk file: %w", err)
	}
	zr.Multistream(false)
	lines := bufio.NewScanner(&cappedReader{r: zr, left: maxBulkFile})
	lines.Buffer(make([]byte, 64<<10), maxCard)
	for n := 1; lines.Scan(); n++ {
		line := bytes.TrimSpace(lines.Bytes())
		if len(line) == 0 {
			continue
		}
		var card Card
		if err := json.Unmarshal(line, &card); err != nil {
			return fmt.Errorf("bulk file: line %d: %w", n, err)
		}
		if err := fn(card); err != nil {
			return err
		}
	}
	if err := lines.Err(); err != nil {
		return fmt.Errorf("bulk file: %w", err)
	}
	return nil
}

// cappedReader fails, instead of quietly stopping, once more than left bytes are read.
type cappedReader struct {
	r    io.Reader
	left int64
}

func (c *cappedReader) Read(p []byte) (int, error) {
	if c.left <= 0 {
		return 0, errors.New("bulk file is larger than expected")
	}
	if int64(len(p)) > c.left {
		p = p[:c.left]
	}
	n, err := c.r.Read(p)
	c.left -= int64(n)
	return n, err
}

func (c *Client) getJSON(ctx context.Context, uri string, v any) error {
	body, err := c.get(ctx, uri, "application/json")
	if err != nil {
		return err
	}
	defer body.Close()
	if err := json.NewDecoder(io.LimitReader(body, maxAPIResponse)).Decode(v); err != nil {
		return fmt.Errorf("decode %s: %w", uri, err)
	}
	return nil
}

func (c *Client) get(ctx context.Context, uri, accept string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", uri, res.Status)
	}
	return res.Body, nil
}
