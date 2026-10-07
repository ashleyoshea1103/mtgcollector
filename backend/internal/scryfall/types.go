package scryfall

import (
	"errors"
	"fmt"
	"net/url"
)

// Card is the part of a Scryfall card object the app uses
// (https://scryfall.com/docs/api/cards). Fields are as Scryfall sends them; checking and
// mapping them is internal/cards' job.
type Card struct {
	ID              string     `json:"id"`
	OracleID        string     `json:"oracle_id"` // missing on reversible cards: see the faces
	Name            string     `json:"name"`
	Lang            string     `json:"lang"`
	ReleasedAt      string     `json:"released_at"` // YYYY-MM-DD
	Layout          string     `json:"layout"`
	ManaCost        *string    `json:"mana_cost"`
	CMC             *float64   `json:"cmc"`
	TypeLine        *string    `json:"type_line"`
	OracleText      *string    `json:"oracle_text"`
	Colors          []string   `json:"colors"`
	ColorIdentity   []string   `json:"color_identity"`
	Faces           []Face     `json:"card_faces"`
	ImageURIs       *ImageURIs `json:"image_uris"`
	Set             string     `json:"set"`
	CollectorNumber string     `json:"collector_number"`
	Rarity          string     `json:"rarity"`
	Finishes        []string   `json:"finishes"`
	Digital         bool       `json:"digital"` // only on MTG Arena or Magic Online
	Prices          Prices     `json:"prices"`
	CardmarketID    *int32     `json:"cardmarket_id"`
	PurchaseURIs    struct {
		Cardmarket string `json:"cardmarket"`
	} `json:"purchase_uris"`
}

// Face is one face of a multi-faced card (split, transform, modal DFC, reversible...).
type Face struct {
	Name       string     `json:"name"`
	OracleID   string     `json:"oracle_id"`
	ManaCost   string     `json:"mana_cost"`
	CMC        *float64   `json:"cmc"`
	TypeLine   string     `json:"type_line"`
	OracleText *string    `json:"oracle_text"`
	Colors     []string   `json:"colors"`
	ImageURIs  *ImageURIs `json:"image_uris"`
}

type ImageURIs struct {
	Small   string `json:"small"`
	Normal  string `json:"normal"`
	Large   string `json:"large"`
	ArtCrop string `json:"art_crop"`
}

// Prices are decimal strings, e.g. "0.31", or null when there's no price.
type Prices struct {
	EUR       *string `json:"eur"`
	EURFoil   *string `json:"eur_foil"`
	USD       *string `json:"usd"`
	USDFoil   *string `json:"usd_foil"`
	USDEtched *string `json:"usd_etched"`
}

// Set is a Scryfall set object (https://scryfall.com/docs/api/sets).
type Set struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	SetType       string `json:"set_type"`
	ReleasedAt    string `json:"released_at"` // YYYY-MM-DD, or missing
	IconSVGURI    string `json:"icon_svg_uri"`
	ParentSetCode string `json:"parent_set_code"`
	Digital       bool   `json:"digital"`
}

// Hosts that URLs stored from Scryfall's data may point at.
const (
	ImageHost      = "cards.scryfall.io"
	SetIconHost    = "svgs.scryfall.io"
	CardmarketHost = "www.cardmarket.com"
)

// CheckURL returns an error unless raw is an absolute https URL on exactly host, with no
// username or password in it. URLs from Scryfall end up in pages and requests, so anything
// else is refused rather than trusted.
func CheckURL(raw, host string) error {
	u, err := url.Parse(raw)
	switch {
	case err != nil:
		return err
	case u.Scheme != "https" && !(u.Scheme == "http" && isLoopback(host)):
		return fmt.Errorf("%q: not https", raw)
	case u.Host != host:
		return fmt.Errorf("%q: not on %s", raw, host)
	case u.User != nil:
		return errors.New("URL has credentials in it")
	}
	return nil
}

// isLoopback is true for the 127.0.0.1:port hosts of httptest servers, which only serve
// plain http. Real Scryfall hosts must use https.
func isLoopback(host string) bool {
	u := url.URL{Host: host}
	return u.Hostname() == "127.0.0.1"
}
