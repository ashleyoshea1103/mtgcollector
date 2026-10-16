package rates

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// daily is an ECB rates file for the day `when`, holding cubes (currency Cube elements).
func daily(when, cubes string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<Cube>
		<Cube time='` + when + `'>` + cubes + `</Cube>
	</Cube>
</gesmes:Envelope>`
}

var tenth = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

func TestParseDailyReadsTheGBPRate(t *testing.T) {
	f, err := os.Open("testdata/eurofxref-daily.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := ParseDaily(f, "GBP", tenth)
	if err != nil {
		t.Fatal(err)
	}
	want := Rate{Currency: "GBP", PerEUR: 0.8712, Date: time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestParseDailyRefusesUnusableFiles(t *testing.T) {
	usd := `<Cube currency='USD' rate='1.0812'/>`
	for name, file := range map[string]string{
		"GBP missing":            daily("2026-10-09", usd),
		"a comma decimal":        daily("2026-10-09", usd+`<Cube currency='GBP' rate='0,8712'/>`),
		"an empty rate":          daily("2026-10-09", usd+`<Cube currency='GBP' rate=''/>`),
		"too low":                daily("2026-10-09", `<Cube currency='GBP' rate='0.4'/>`),
		"too high":               daily("2026-10-09", `<Cube currency='GBP' rate='1.6'/>`),
		"negative":               daily("2026-10-09", `<Cube currency='GBP' rate='-1'/>`),
		"two GBP rates":          daily("2026-10-09", `<Cube currency='GBP' rate='0.8712'/><Cube currency='GBP' rate='0.8713'/>`),
		"no dated Cube":          strings.Replace(daily("2026-10-09", `<Cube currency='GBP' rate='0.8712'/>`), ` time='2026-10-09'`, ``, 1),
		"an unreadable day":      daily("9 Oct 2026", `<Cube currency='GBP' rate='0.8712'/>`),
		"the day after tomorrow": daily("2026-10-12", `<Cube currency='GBP' rate='0.8712'/>`),
		"malformed XML":          strings.TrimSuffix(daily("2026-10-09", `<Cube currency='GBP' rate='0.8712'/>`), "</gesmes:Envelope>") + "<Cube",
		"not XML at all":         "<html><body>Service unavailable</body></html>",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := ParseDaily(strings.NewReader(file), "GBP", tenth)
			if !errors.Is(err, ErrInvalid) {
				t.Errorf("got %+v, %v; want an error wrapping ErrInvalid", got, err)
			}
		})
	}
}

// The ECB publishes a day's rates that afternoon (about 16:00 Frankfurt time, 14:00 or 15:00
// UTC), so a real file is never dated after today in UTC. One dated tomorrow is refused, even
// late in the UTC day: the store keeps the latest date, so it would pin its rate for days.
func TestParseDailyRefusesTomorrow(t *testing.T) {
	late := time.Date(2026, 10, 10, 23, 59, 0, 0, time.UTC)
	got, err := ParseDaily(strings.NewReader(daily("2026-10-11", `<Cube currency='GBP' rate='0.8712'/>`)), "GBP", late)
	if !errors.Is(err, ErrInvalid) {
		t.Errorf("got %+v, %v; want a file dated tomorrow refused", got, err)
	}
}

// Today is the day, whatever the time: the check compares dates.
func TestParseDailyAcceptsToday(t *testing.T) {
	midnight := time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)
	got, err := ParseDaily(strings.NewReader(daily("2026-10-10", `<Cube currency='GBP' rate='0.8712'/>`)), "GBP", midnight)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Date.Equal(midnight) {
		t.Errorf("date %v, want %v", got.Date, midnight)
	}
}

func TestECBDailyFetchesAndParses(t *testing.T) {
	file, err := os.ReadFile("testdata/eurofxref-daily.xml")
	if err != nil {
		t.Fatal(err)
	}
	var agent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		agent = r.Header.Get("User-Agent")
		_, _ = w.Write(file)
	}))
	defer srv.Close()
	got, err := ECB{URL: srv.URL, Client: srv.Client()}.Daily(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if got.Currency != "GBP" || got.PerEUR != 0.8712 {
		t.Errorf("got %+v, want GBP at 0.8712", got)
	}
	if agent != userAgent {
		t.Errorf("User-Agent %q, want %q", agent, userAgent)
	}
}

func TestECBDailyRefusesAnOversizedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A valid file, padded past the cap: the cap, not the parser, must refuse it.
		_, _ = w.Write([]byte(strings.Replace(daily("2026-10-09", `<Cube currency='GBP' rate='0.8712'/>`), "<Cube>", "<!--"+strings.Repeat("x", 65<<10)+"--><Cube>", 1)))
	}))
	defer srv.Close()
	if _, err := (ECB{URL: srv.URL, Client: srv.Client()}).Daily(t.Context()); err == nil {
		t.Error("a 65 KB body was accepted")
	}
}

// The ECB client follows redirects only within the ECB, over HTTPS, and only a few of them; the
// error says which refusal it was.
func TestECBClientRedirectsOnlyWithinTheECB(t *testing.T) {
	to := func(url string) *http.Request {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			t.Fatal(err)
		}
		return req
	}
	from := []*http.Request{to(DailyURL)}
	if err := ecbClient.CheckRedirect(to("https://www.ecb.europa.eu/stats/eurofxref/moved.xml"), from); err != nil {
		t.Errorf("a redirect within the ECB was refused: %v", err)
	}
	for _, url := range []string{
		"http://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
		"https://ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
		"https://www.ecb.europa.eu.example.com/eurofxref-daily.xml",
		"https://example.com/eurofxref-daily.xml",
	} {
		if err := ecbClient.CheckRedirect(to(url), from); err == nil || !strings.Contains(err.Error(), "away from the ECB") {
			t.Errorf("redirect to %s: got %v, want it refused as leaving the ECB", url, err)
		}
	}
	loop := []*http.Request{from[0], from[0], from[0], from[0], from[0]}
	if err := ecbClient.CheckRedirect(to(DailyURL), loop); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("a sixth redirect within the ECB: got %v, want it refused as too many redirects", err)
	}
}

// Daily's default client is the ECB client: a redirect elsewhere is refused before it's followed.
func TestECBDailyRefusesARedirectAway(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.com/eurofxref-daily.xml", http.StatusFound)
	}))
	defer srv.Close()
	_, err := ECB{URL: srv.URL}.Daily(t.Context())
	if err == nil || !strings.Contains(err.Error(), "away from the ECB") {
		t.Errorf("got %v, want the redirect refused", err)
	}
}

func TestECBDailyRefusesAnErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	if _, err := (ECB{URL: srv.URL, Client: srv.Client()}).Daily(t.Context()); err == nil {
		t.Error("a 503 was accepted")
	}
}
