// Package rates keeps the European Central Bank's daily euro exchange rates, so the app can
// show Cardmarket's euro prices in pounds.
package rates

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
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
