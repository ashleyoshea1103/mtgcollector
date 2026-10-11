package api

import (
	"context"
	"net/http"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// Collection answers the collection endpoints, for one user at a time.
// *collection.Service satisfies it.
type Collection interface {
	Add(ctx context.Context, userID int64, e contract.NewEntry) (contract.CollectionEntry, bool, error)
	Change(ctx context.Context, userID, id int64, c contract.EntryChange) (contract.CollectionEntry, error)
	Delete(ctx context.Context, userID, id int64) error
	Groups(ctx context.Context, userID int64, by contract.GroupBy) (contract.CollectionGroups, error)
	Entries(ctx context.Context, userID int64, q collection.EntryQuery) (contract.EntryPage, error)
	Stats(ctx context.Context, userID int64) (contract.CollectionStats, error)
}

// GET /api/collection/groups?group_by=: the signed-in user's groups.
func collectionGroups(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		by := contract.GroupBy(r.URL.Query().Get("group_by"))
		if by == "" {
			by = contract.GroupByNone
		}
		res, err := c.Groups(r.Context(), user.ID, by)
		result(w, r, http.StatusOK, res, err)
	}
}

// GET /api/collection/entries?group_by=&key=&sort=&cursor=: a page of one group's entries.
func collectionEntries(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		res, err := c.Entries(r.Context(), user.ID, entryQuery(r))
		result(w, r, http.StatusOK, res, err)
	}
}

// GET /api/collection/stats: totals for the whole collection.
func collectionStats(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		res, err := c.Stats(r.Context(), user.ID)
		result(w, r, http.StatusOK, res, err)
	}
}

// POST /api/collection/entries (NewEntry): 201 with a new entry, or 200 with the one it added to.
func addEntry(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		var e contract.NewEntry
		if !decodeJSON(w, r, &e) {
			return
		}
		res, created, err := c.Add(r.Context(), user.ID, e)
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		result(w, r, status, res, err)
	}
}

// PATCH /api/collection/entries/{id} (EntryChange): the changed entry.
func changeEntry(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrNotFound)
		if !ok {
			return
		}
		var change contract.EntryChange
		if !decodeJSON(w, r, &change) {
			return
		}
		res, err := c.Change(r.Context(), user.ID, id, change)
		result(w, r, http.StatusOK, res, err)
	}
}

// DELETE /api/collection/entries/{id}: 204.
func deleteEntry(c Collection) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrNotFound)
		if !ok {
			return
		}
		noContent(w, r, c.Delete(r.Context(), user.ID, id))
	}
}

// entryQuery reads which entries to list from ?group_by=&key=&sort=&cursor=.
func entryQuery(r *http.Request) collection.EntryQuery {
	q := r.URL.Query()
	return collection.EntryQuery{
		GroupBy: contract.GroupBy(q.Get("group_by")), Key: q.Get("key"), Sort: contract.SortBy(q.Get("sort")), Cursor: q.Get("cursor"),
	}
}

// result writes a result with status, or the error as its status.
func result(w http.ResponseWriter, r *http.Request, status int, res any, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, status, res)
}

// noContent answers 204 for a change that has nothing to send back, or the error as its status.
func noContent(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
