package api

import (
	"context"
	"net/http"
	"strconv"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// CustomGroups answers the custom group endpoints, for one user at a time.
// *collection.Service satisfies it.
type CustomGroups interface {
	ListGroups(ctx context.Context, userID int64) (contract.CustomGroupList, error)
	Group(ctx context.Context, userID, id int64) (contract.CustomGroup, error)
	CreateGroup(ctx context.Context, userID int64, g contract.NewGroup) (contract.CustomGroup, error)
	ChangeGroup(ctx context.Context, userID, id int64, c contract.GroupChange) (contract.CustomGroup, error)
	DeleteGroup(ctx context.Context, userID, id int64) error
	GroupGroups(ctx context.Context, userID, groupID int64, by contract.GroupBy) (contract.CollectionGroups, error)
	Members(ctx context.Context, userID, groupID int64, q collection.EntryQuery) (contract.GroupMemberPage, error)
	SetMember(ctx context.Context, userID, groupID, entryID int64, quantity int) (contract.GroupMember, bool, error)
	RemoveMember(ctx context.Context, userID, groupID, entryID int64) error
}

// GET /api/groups: the user's groups.
func listGroups(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		res, err := g.ListGroups(r.Context(), user.ID)
		result(w, r, http.StatusOK, res, err)
	}
}

// POST /api/groups (NewGroup): 201 with the new group.
func createGroup(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		var ng contract.NewGroup
		if !decodeJSON(w, r, &ng) {
			return
		}
		res, err := g.CreateGroup(r.Context(), user.ID, ng)
		result(w, r, http.StatusCreated, res, err)
	}
}

// GET /api/groups/{id}: one group.
func getGroup(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		res, err := g.Group(r.Context(), user.ID, id)
		result(w, r, http.StatusOK, res, err)
	}
}

// PATCH /api/groups/{id} (GroupChange): the changed group.
func changeGroup(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		var c contract.GroupChange
		if !decodeJSON(w, r, &c) {
			return
		}
		res, err := g.ChangeGroup(r.Context(), user.ID, id, c)
		result(w, r, http.StatusOK, res, err)
	}
}

// DELETE /api/groups/{id}: 204. The cards in it stay in the collection.
func deleteGroup(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		noContent(w, r, g.DeleteGroup(r.Context(), user.ID, id))
	}
}

// GET /api/groups/{id}/groups?group_by=: the group's members grouped, as the collection's are.
func groupGroups(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		res, err := g.GroupGroups(r.Context(), user.ID, id, contract.GroupBy(r.URL.Query().Get("group_by")))
		result(w, r, http.StatusOK, res, err)
	}
}

// GET /api/groups/{id}/members?group_by=&key=&sort=&cursor=: a page of the group's members.
func groupMembers(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		id, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		res, err := g.Members(r.Context(), user.ID, id, entryQuery(r))
		result(w, r, http.StatusOK, res, err)
	}
}

// PUT /api/groups/{id}/members/{entry_id} (MemberQuantity): 201 with the member when the
// entry is new to the group, 200 when its quantity there changed.
func setMember(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		groupID, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		entryID, ok := pathID(w, r, "entry_id", collection.ErrNotFound)
		if !ok {
			return
		}
		var q contract.MemberQuantity
		if !decodeJSON(w, r, &q) {
			return
		}
		res, created, err := g.SetMember(r.Context(), user.ID, groupID, entryID, q.Quantity)
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		result(w, r, status, res, err)
	}
}

// DELETE /api/groups/{id}/members/{entry_id}: 204. The entry stays in the collection.
func removeMember(g CustomGroups) func(http.ResponseWriter, *http.Request, contract.User) {
	return func(w http.ResponseWriter, r *http.Request, user contract.User) {
		groupID, ok := pathID(w, r, "id", collection.ErrGroupNotFound)
		if !ok {
			return
		}
		entryID, ok := pathID(w, r, "entry_id", collection.ErrNotFound)
		if !ok {
			return
		}
		noContent(w, r, g.RemoveMember(r.Context(), user.ID, groupID, entryID))
	}
}

// pathID reads an id from the path. One that can't be an id is the same 404 as one that
// isn't the user's.
func pathID(w http.ResponseWriter, r *http.Request, name string, notFound error) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id < 1 {
		writeError(w, http.StatusNotFound, notFound.Error())
		return 0, false
	}
	return id, true
}
