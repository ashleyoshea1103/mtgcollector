package contract

import (
	"encoding"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Every struct the API sends or receives.
var all = []any{
	CardImages{}, CardFace{}, Prices{}, CardSet{}, CardSummary{}, Card{}, CollectionEntry{}, ValueTotal{},
	GroupSummary{}, EntryPage{}, GroupMember{}, GroupMemberPage{}, CustomGroup{}, CollectionStats{},
	Health{}, NewEntry{}, CardPage{}, CardNames{}, APIError{}, User{}, Credentials{}, CollectionGroups{}, EntryChange{}, CustomGroupList{}, NewGroup{}, GroupChange{}, MemberQuantity{},
}

// `all` must list every struct in the package's Go files, or the rule test below misses it.
func TestAllListsEveryStruct(t *testing.T) {
	listed := map[string]bool{}
	for _, v := range all {
		listed[reflect.TypeOf(v).Name()] = true
	}
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		// enums.go is Go-only (tygo leaves it out): its EnumError is an error, not JSON.
		if strings.HasSuffix(name, "_test.go") || name == "enums.go" {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		file, err := parser.ParseFile(token.NewFileSet(), name, src, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			if spec, ok := n.(*ast.TypeSpec); ok {
				if _, isStruct := spec.Type.(*ast.StructType); isStruct && !listed[spec.Name.Name] {
					t.Errorf("%s: struct %s is missing from `all`", name, spec.Name.Name)
				}
			}
			return true
		})
	}
}

// The rules in doc.go that tygo can't check: they decide whether types.ts tells
// the truth about the JSON.
func TestStructsFollowTheContractRules(t *testing.T) {
	for _, v := range all {
		typ := reflect.TypeOf(v)
		for i := range typ.NumField() {
			f := typ.Field(i)
			where := typ.Name() + "." + f.Name
			tstype := f.Tag.Get("tstype")
			name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
			if f.Anonymous {
				// encoding/json flattens an embedded struct only when it has no json name, and a
				// nil embedded pointer drops all its fields; the TypeScript always extends it.
				if tstype != ",extends" || name != "" || f.Type.Kind() != reflect.Struct {
					t.Errorf("%s: embed structs by value, with no json tag and `tstype:\",extends\"`", where)
				}
				continue
			}
			if name == "" || name == "-" {
				t.Errorf("%s: needs a json name", where)
			}
			nullable := strings.HasSuffix(tstype, " | null,required")
			// Omitted when nil, a pointer field is optional in the TypeScript (it's only received).
			omitted := strings.Contains(opts, "omitempty") && tstype == ""
			if f.Type.Kind() == reflect.Pointer && !nullable && !omitted {
				t.Errorf("%s: a pointer is encoded as null, so it needs `tstype:\"T | null,required\"` (got %q)", where, tstype)
			}
			if strings.Contains(tstype, "| null") && !canBeNull(f.Type) {
				t.Errorf("%s: says it can be null, but a %s never encodes as null", where, f.Type.Kind())
			}
			// The TypeScript says the key is always there (null or not), so it can't be left out.
			if nullable && (strings.Contains(opts, "omitempty") || strings.Contains(opts, "omitzero")) {
				t.Errorf("%s: `,required` in the TypeScript but omitempty/omitzero in the JSON", where)
			}
		}
	}
}

func canBeNull(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Pointer, reflect.Slice, reflect.Map:
		return true
	}
	return false
}

func TestJSONEncodingMatchesTheTypeScript(t *testing.T) {
	price := 7.5
	entry := CollectionEntry{
		ID:           9007199254740991, // the largest integer a JS number holds exactly
		Card:         CardSummary{Colors: []string{}, ColorIdentity: []string{}, Finishes: []Finish{FinishFoil}},
		Quantity:     2,
		Finish:       FinishFoil,
		Condition:    ConditionNM,
		UnitPriceEUR: &price,
	}
	b, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}

	// IDs and money are JSON numbers, never strings.
	if _, ok := got["id"].(float64); !ok {
		t.Errorf("id = %#v, want a number", got["id"])
	}
	if got["unit_price_eur"] != 7.5 {
		t.Errorf("unit_price_eur = %#v, want 7.5", got["unit_price_eur"])
	}
	// A missing price is null, not absent and not 0.
	if v, present := got["value_eur"]; !present || v != nil {
		t.Errorf("value_eur = %#v (present %v), want null", v, present)
	}
	card := got["card"].(map[string]any)
	if v, present := card["images"]; !present || v != nil {
		t.Errorf("card.images = %#v (present %v), want null", v, present)
	}
	prices := card["prices"].(map[string]any)
	for _, k := range []string{"eur", "eur_foil", "usd", "usd_foil", "usd_etched"} {
		if v, present := prices[k]; !present || v != nil {
			t.Errorf("prices.%s = %#v (present %v), want null", k, v, present)
		}
	}
	// Enums encode as their string values.
	if got["finish"] != "foil" || got["condition"] != "NM" {
		t.Errorf("finish, condition = %v, %v", got["finish"], got["condition"])
	}
}

func TestEmbeddedTotalsAreFlattened(t *testing.T) {
	b, err := json.Marshal(GroupSummary{ValueTotal: ValueTotal{CardCount: 3, ValueEUR: 1.5, UnpricedCount: 1}, Key: "R"})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"card_count":3,"value_eur":1.5,"unpriced_count":1,"key":"R","label":"","set":null,"entry_count":0}`
	if string(b) != want {
		t.Errorf("got  %s\nwant %s", b, want)
	}
}

// Every enum: a string type with constants.
var enums = []any{
	new(Finish), new(Condition), new(Language), new(Rarity), new(ImageSize), new(GroupBy), new(SortBy),
	new(CustomGroupKind), new(HealthStatus),
}

// Every enum reads its own constants, and only those (enums.go).
func TestEnumsReadOnlyTheirOwnValues(t *testing.T) {
	listed := map[string]reflect.Type{}
	for _, v := range enums {
		listed[reflect.TypeOf(v).Elem().Name()] = reflect.TypeOf(v)
	}
	consts := map[string][]string{} // type name: its constants' values
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), name, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.TypeSpec:
				if id, ok := n.Type.(*ast.Ident); ok && id.Name == "string" {
					if _, seen := consts[n.Name.Name]; !seen {
						consts[n.Name.Name] = nil // an enum, maybe without constants yet
					}
				}
			case *ast.ValueSpec:
				if typ, ok := n.Type.(*ast.Ident); ok && len(n.Values) == 1 {
					if lit, ok := n.Values[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						consts[typ.Name] = append(consts[typ.Name], strings.Trim(lit.Value, "\""))
					}
				}
			}
			return true
		})
	}
	for name, values := range consts {
		typ, ok := listed[name]
		if !ok {
			t.Errorf("enum %s is missing from `enums`", name)
			continue
		}
		if len(values) == 0 {
			t.Errorf("enum %s has no constants", name)
		}
		for _, v := range values {
			dst := reflect.New(typ.Elem()).Interface().(encoding.TextUnmarshaler)
			if err := dst.UnmarshalText([]byte(v)); err != nil {
				t.Errorf("%s refuses its own constant %q: %v", name, v, err)
			} else if got := reflect.ValueOf(dst).Elem().String(); got != v {
				t.Errorf("%s read %q as %q", name, v, got)
			}
		}
		for _, bad := range []string{"", "bogus", strings.ToUpper(values[0]) + "x", " " + values[0]} {
			dst := reflect.New(typ.Elem()).Interface().(encoding.TextUnmarshaler)
			var enumErr *EnumError
			if err := dst.UnmarshalText([]byte(bad)); !errors.As(err, &enumErr) || !strings.Contains(err.Error(), values[0]) {
				t.Errorf("%s read %q: %v, want an EnumError listing its values", name, bad, err)
			}
		}
	}
}

func TestAnUnknownEnumValueInJSONIsAnError(t *testing.T) {
	var e NewEntry
	err := json.Unmarshal([]byte(`{"finish":"shiny"}`), &e)
	var enumErr *EnumError
	if !errors.As(err, &enumErr) || err.Error() == "" || !strings.Contains(enumErr.Error(), "finish must be one of nonfoil, foil, etched") {
		t.Errorf("= %v, want the EnumError", err)
	}
}
