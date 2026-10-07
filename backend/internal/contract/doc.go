// Package contract defines the JSON the API sends and receives. It is the single
// source of truth for the API's shapes: tygo generates frontend/src/types.ts from
// it (see backend/tygo.yaml), and verify fails if the committed file is stale.
//
// Doc comments in contract.go are copied into the TypeScript, so write them for
// both sides. This file is left out of the generated output.
//
// Rules for the structs:
//   - A field that can be null is a pointer with `tstype:"T | null,required"`, so the
//     TypeScript says null rather than optional.
//   - Slices and maps without `| null` must never be nil when encoded: encoding/json
//     writes a nil slice as null, which the TypeScript doesn't allow.
package contract
