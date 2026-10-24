package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// The largest request body the API reads.
const maxBodyBytes = 16 << 10

// decodeJSON reads the request's JSON body into dst, or answers with what was wrong and
// returns false. The body must be one JSON value of dst's shape: no unknown fields (a typo in
// a field name is an error, not a silently ignored value) and nothing after it. Requiring
// application/json also means a page on another site can't send it without CORS preflight.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "send the body as application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	err := dec.Decode(dst)
	if err == nil {
		// Anything but the end of the body after the value is an error.
		if extra := dec.Decode(&struct{}{}); extra != io.EOF {
			err = errors.Join(errors.New("more than one JSON value"), extra) // keeps a MaxBytesError
		}
	}
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	var typeErr *json.UnmarshalTypeError
	var enumErr *contract.EnumError
	switch {
	case errors.As(err, &tooBig):
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the body can't be more than %d bytes", maxBodyBytes))
	case errors.As(err, &enumErr):
		writeError(w, http.StatusBadRequest, enumErr.Error())
	case errors.As(err, &typeErr) && typeErr.Field != "":
		writeError(w, http.StatusBadRequest, fmt.Sprintf("%s has the wrong type", typeErr.Field))
	default:
		writeError(w, http.StatusBadRequest, "the body isn't the JSON this endpoint takes")
	}
	return false
}
