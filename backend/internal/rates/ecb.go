// Package rates keeps the European Central Bank's daily euro exchange rates, so the app can
// show Cardmarket's euro prices in pounds.
package rates

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

// Rate is one currency's rate on one day: PerEUR of it buy one euro.
type Rate struct {
	Currency string
	PerEUR   float64
	// The ECB's day for the rate, at midnight UTC.
	Date time.Time
}

// ErrInvalid is a rates file that can't be used: every refusal wraps it.
var ErrInvalid = errors.New("the ECB's rates file isn't usable")

// The range a GBP rate must be in. Pounds per euro have stayed well inside it; a value
// outside means a broken file, not a market move.
const (
	minRate = 0.5
	maxRate = 1.5
)

// A rate is digits, a point and digits: "0.8712". Anything else ("0,8712", "", "-1") is refused
// rather than guessed at.
var decimal = regexp.MustCompile(`^[0-9]+\.[0-9]+$`)

// The ECB's daily file: Envelope > Cube > Cube[time] > Cube[currency, rate]. Namespaces are
// ignored: the elements are matched by their local names.
type envelope struct {
	XMLName xml.Name `xml:"Envelope"`
	Days    []struct {
		Time  string `xml:"time,attr"`
		Rates []struct {
			Currency string `xml:"currency,attr"`
			Rate     string `xml:"rate,attr"`
		} `xml:"Cube"`
	} `xml:"Cube>Cube"`
}

// ParseDaily reads the ECB's daily rates file and returns currency's rate. It refuses (with
// ErrInvalid) a file that isn't the ECB's shape, a missing, repeated or malformed rate, a rate
// outside a sane range, and a date after tomorrow: ECB time is ahead of UTC, so late in a UTC
// day the file can be dated tomorrow, but no further.
func ParseDaily(r io.Reader, currency string, now time.Time) (Rate, error) {
	var file envelope
	if err := xml.NewDecoder(r).Decode(&file); err != nil {
		return Rate{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if len(file.Days) != 1 || file.Days[0].Time == "" {
		return Rate{}, fmt.Errorf("%w: want one dated day of rates, found %d", ErrInvalid, len(file.Days))
	}
	day := file.Days[0]
	date, err := time.Parse(time.DateOnly, day.Time)
	if err != nil {
		return Rate{}, fmt.Errorf("%w: the day %q isn't a date", ErrInvalid, day.Time)
	}
	today := now.UTC()
	if tomorrow := time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, time.UTC); date.After(tomorrow) {
		return Rate{}, fmt.Errorf("%w: the rates are dated %s, in the future", ErrInvalid, day.Time)
	}

	var found []string
	for _, c := range day.Rates {
		if c.Currency == currency {
			found = append(found, c.Rate)
		}
	}
	if len(found) != 1 {
		return Rate{}, fmt.Errorf("%w: want one %s rate, found %d", ErrInvalid, currency, len(found))
	}
	if !decimal.MatchString(found[0]) {
		return Rate{}, fmt.Errorf("%w: the %s rate %q isn't a decimal", ErrInvalid, currency, found[0])
	}
	perEUR, err := strconv.ParseFloat(found[0], 64)
	if err != nil || perEUR < minRate || perEUR > maxRate {
		return Rate{}, fmt.Errorf("%w: the %s rate %s is outside %v–%v", ErrInvalid, currency, found[0], minRate, maxRate)
	}
	return Rate{Currency: currency, PerEUR: perEUR, Date: date}, nil
}

// DailyURL is the ECB's daily euro reference rates.
const DailyURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"

const (
	fetchTimeout = 10 * time.Second
	// The file is about 2 KB; anything near this is not the ECB's file.
	maxBody   = 64 << 10
	userAgent = "mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)"
)

// Source is where the rates come from: the ECB, or a fake in tests.
type Source interface {
	Daily(ctx context.Context) (Rate, error)
}

// The client for the ECB: it follows a redirect only to the ECB itself, over HTTPS.
var ecbClient = &http.Client{
	Timeout: fetchTimeout,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.Host != "www.ecb.europa.eu" || len(via) >= 5 {
			return fmt.Errorf("redirected away from the ECB, to %s", req.URL.Redacted())
		}
		return nil
	},
}

// ECB fetches today's GBP rate from the ECB's daily file. Its zero value is ready to use;
// tests point URL and Client at a fake server.
type ECB struct {
	URL    string
	Client *http.Client
}

// Daily fetches and parses the ECB's daily file, refusing an error status or a body over
// 64 KB as well as everything ParseDaily refuses.
func (e ECB) Daily(ctx context.Context) (Rate, error) {
	url, client := e.URL, e.Client
	if url == "" {
		url = DailyURL
	}
	if client == nil {
		client = ecbClient
	}
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Rate{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/xml, text/xml")
	resp, err := client.Do(req)
	if err != nil {
		return Rate{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Rate{}, fmt.Errorf("the ECB answered %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return Rate{}, err
	}
	if len(body) > maxBody {
		return Rate{}, fmt.Errorf("%w: more than %d bytes", ErrInvalid, maxBody)
	}
	return ParseDaily(bytes.NewReader(body), "GBP", time.Now())
}
