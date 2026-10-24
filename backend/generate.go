// Package backend holds the module's code generation. Run `go generate ./...` in
// backend/ after changing the SQL (migrations or queries) or the API contract.
package backend

//go:generate go tool -modfile=tools/go.mod sqlc generate
//go:generate go tool -modfile=tools/go.mod tygo generate
