package contract

import (
	"fmt"
	"slices"
	"strings"
)

// Each enum reads only its own values: an unknown one (from JSON, or a query parameter
// read with UnmarshalText) is an error, never a value the server then has to cope with.
// contract_test.go checks every enum type here has this, and accepts all its constants.

func (v *Finish) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "finish", FinishNonfoil, FinishFoil, FinishEtched)
}

func (v *Condition) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "condition", ConditionMT, ConditionNM, ConditionEX, ConditionGD, ConditionLP, ConditionPL, ConditionPO)
}

func (v *Language) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "language", Languages...)
}

// Languages are the values of Language, in Scryfall's order.
var Languages = []Language{
	LanguageEnglish, LanguageGerman, LanguageFrench, LanguageItalian, LanguageSpanish, LanguagePortuguese,
	LanguageJapanese, LanguageKorean, LanguageRussian, LanguageSimplifiedChinese, LanguageTraditionalChinese,
	LanguageHebrew, LanguageLatin, LanguageAncientGreek, LanguageArabic, LanguageSanskrit, LanguagePhyrexian,
	LanguageQuenya,
}

func (v *Rarity) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "rarity", RarityCommon, RarityUncommon, RarityRare, RarityMythic, RaritySpecial, RarityBonus)
}

func (v *ImageSize) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "image size", ImageSizeSmall, ImageSizeNormal, ImageSizeLarge, ImageSizeArtCrop)
}

func (v *GroupBy) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "group_by", GroupByNone, GroupBySet, GroupByColor, GroupByType, GroupByRarity, GroupByCMC)
}

func (v *SortBy) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "sort", SortByName, SortByPrice, SortByCMC, SortByAdded)
}

func (v *CustomGroupKind) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "kind", CustomGroupKindBinder, CustomGroupKindDeck, CustomGroupKindBox, CustomGroupKindOther)
}

func (v *HealthStatus) UnmarshalText(b []byte) error {
	return parseEnum(b, v, "status", HealthStatusOK, HealthStatusUnavailable)
}

// EnumError is a value an enum doesn't have; its message says which it does.
type EnumError struct {
	Name  string // what the value is, as the API calls it: "finish", "group_by"
	Valid []string
}

func (e *EnumError) Error() string {
	return fmt.Sprintf("%s must be one of %s", e.Name, strings.Join(e.Valid, ", "))
}

func parseEnum[T ~string](b []byte, dst *T, name string, valid ...T) error {
	if v := T(b); slices.Contains(valid, v) {
		*dst = v
		return nil
	}
	e := &EnumError{Name: name}
	for _, v := range valid {
		e.Valid = append(e.Valid, string(v))
	}
	return e
}
