package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// Cards answers the card endpoints. *cards.Searcher satisfies it.
type Cards interface {
	Search(ctx context.Context, q cards.Search) (contract.CardPage, error)
	Autocomplete(ctx context.Context, typed string) (contract.CardNames, error)
	Card(ctx context.Context, id string) (contract.Card, error)
	Printings(ctx context.Context, id string, page int) (contract.CardPage, error)
}

// GET /api/cards/search?q=&set=&type=&rarity=&colors=&extras=&page=
func searchCards(c Cards) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, ok := pageParam(w, r)
		if !ok {
			return
		}
		extras := false
		if v := q.Get("extras"); v != "" {
			var err error
			if extras, err = strconv.ParseBool(v); err != nil {
				writeError(w, http.StatusBadRequest, "extras must be true or false")
				return
			}
		}
		res, err := c.Search(r.Context(), cards.Search{
			Name: q.Get("q"), Set: q.Get("set"), Type: q.Get("type"), Rarity: contract.Rarity(q.Get("rarity")),
			Colors: q.Get("colors"), IncludeExtras: extras, Page: page,
		})
		respond(w, r, res, err)
	}
}

// GET /api/cards/autocomplete?q=
func autocomplete(c Cards) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res, err := c.Autocomplete(r.Context(), r.URL.Query().Get("q"))
		respond(w, r, res, err)
	}
}

// GET /api/cards/{id}
func getCard(c Cards) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res, err := c.Card(r.Context(), r.PathValue("id"))
		respond(w, r, res, err)
	}
}

// GET /api/cards/{id}/printings?page=
func printings(c Cards) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, ok := pageParam(w, r)
		if !ok {
			return
		}
		res, err := c.Printings(r.Context(), r.PathValue("id"), page)
		respond(w, r, res, err)
	}
}

// pageParam reads ?page= (default 1); the range is checked by the searcher.
func pageParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	v := r.URL.Query().Get("page")
	if v == "" {
		return 1, true
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		writeError(w, http.StatusBadRequest, "page must be a number")
		return 0, false
	}
	return n, true
}

// respond writes a result, or the error as the right status: the caller's mistakes say
// what was wrong; anything else is logged and reported without details.
func respond(w http.ResponseWriter, r *http.Request, res any, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, res)
	case isTimeout(err):
		slog.WarnContext(r.Context(), "card query timed out", "path", r.URL.Path, "error", err)
		writeError(w, http.StatusServiceUnavailable, "that took too long; try a narrower search")
	default:
		fail(w, r, err)
	}
}

// The status for each kind of caller's mistake.
var statusOf = map[apperr.Kind]int{
	apperr.Invalid:      http.StatusBadRequest,
	apperr.NotFound:     http.StatusNotFound,
	apperr.Conflict:     http.StatusConflict,
	apperr.Unauthorized: http.StatusUnauthorized,
}

// fail answers with an error: a caller's mistake (an apperr.Error) with its status and
// message, anything else as a server error.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *apperr.Error
	if errors.As(err, &e) {
		if status, ok := statusOf[e.Kind]; ok {
			writeError(w, status, e.Msg)
			return
		}
	}
	serverError(w, r, err)
}

// serverError answers for a failure that isn't the caller's: a query that ran out of time
// (503), a client that went away (nothing), or anything else (500), logged with no details
// in the response.
func serverError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case isTimeout(err):
		slog.WarnContext(r.Context(), "query timed out", "path", r.URL.Path, "error", err)
		writeError(w, http.StatusServiceUnavailable, "that took too long; try again")
	case errors.Is(err, context.Canceled):
		// The client went away; there's no one to answer.
	default:
		slog.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "error", err)
		writeError(w, http.StatusInternalServerError, "something went wrong")
	}
}

// isTimeout reports a query that ran out of time. A query whose client went away is cancelled
// too, but that isn't a timeout: the searcher adds the context's reason to Postgres's error.
func isTimeout(err error) bool {
	return !errors.Is(err, context.Canceled) && (errors.Is(err, context.DeadlineExceeded) || isQueryCanceled(err))
}

// isQueryCanceled reports a query Postgres stopped because it was asked to (SQLSTATE 57014,
// query_canceled): pgx asks when a query's context runs out, and the error that comes back
// may be Postgres's rather than the context's.
func isQueryCanceled(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "57014"
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, contract.APIError{Error: msg})
}
