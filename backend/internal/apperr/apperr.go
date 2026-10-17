// Package apperr is the errors services give for what a caller asked, rather than for what
// went wrong inside: each has a kind, which the API answers the same way whatever the
// service (a 400, 404, 409 or 401), and a message for the user.
package apperr

import (
	"errors"
	"fmt"
)

// Kind is what sort of mistake an Error is.
type Kind int

const (
	Invalid      Kind = iota + 1 // the request can't be done as asked
	NotFound                     // what it names doesn't exist (or isn't the caller's)
	Conflict                     // it clashes with what's already there
	Unauthorized                 // the caller isn't signed in, or couldn't sign in
)

// Error is a caller's mistake, and what to tell them.
type Error struct {
	Kind Kind
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

// New returns an Error of a kind, with its message from format and args. Sentinel errors made
// with it match with errors.Is, as the same pointer.
func New(kind Kind, format string, args ...any) *Error {
	return &Error{Kind: kind, Msg: fmt.Sprintf(format, args...)}
}

// KindOf is the kind of the Error in err's chain, or 0 if there's none.
func KindOf(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return 0
}
