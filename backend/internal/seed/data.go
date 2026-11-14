package seed

import "github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"

// card is a printing, by its Scryfall id (which stays the same however Scryfall's data
// changes), with its name and set for messages and for reading this file.
type card struct{ id, name, set string }

func (c card) String() string { return c.name + " (" + c.set + ")" }

// entry is copies of a card to add, and how many of them go in which groups.
type entry struct {
	card      card
	quantity  int
	finish    contract.Finish
	condition contract.Condition
	language  contract.Language
	in        map[string]int // group name: copies in it
	gone      bool           // marked as a printing Scryfall no longer lists, after it's added
}

// Groups' names, as entries refer to them.
const (
	binder = "Trade binder"
	deck   = "Mono-red burn"
	box    = "Bulk box"
	toSort = "To sort"
)

var groups = []contract.NewGroup{
	{Name: binder, Kind: contract.CustomGroupKindBinder, Description: "Cards up for trade."},
	{Name: deck, Kind: contract.CustomGroupKindDeck, Description: "Fast red aggro: burn and cheap creatures."},
	{Name: box, Kind: contract.CustomGroupKindBox, Description: "Commons, uncommons and basic lands, unsorted."},
	{Name: toSort, Kind: contract.CustomGroupKindOther}, // left empty
}

// The printings, by colour identity, then the special cases.
var (
	swords        = card{"cc9ece2f-7eda-4fc5-a562-3e16e71560e9", "Swords to Plowshares", "sta 10"}
	wrath         = card{"b969f680-b176-4bfa-a160-714de8e03c25", "Wrath of God", "10e 61"}
	serraAngel    = card{"b56b9131-4f7e-4912-ba47-63ed82f21d1b", "Serra Angel", "dom 33"}
	thalia        = card{"824423ff-6441-4be6-b754-810adf9ca6a2", "Thalia, Guardian of Thraben", "dka 24"}
	solitude      = card{"47a6234f-309f-4e03-9263-66da48b57153", "Solitude", "mh2 32"}
	rangerCaptain = card{"af3928b4-813a-4120-8799-de34235d60ac", "Ranger-Captain of Eos", "mh1 21"}

	counterspell = card{"1920dae4-fb92-4f19-ae4b-eb3276b8dac7", "Counterspell", "mh2 267"}
	delver       = card{"11bf83bb-c95b-4b4f-9a56-ce7a1816307a", "Delver of Secrets // Insectile Aberration", "isd 51"}
	brainstorm   = card{"11d27509-07c2-4445-a1d5-e56523fb8566", "Brainstorm", "sta 13"}
	ponder       = card{"81c908ee-e70a-4406-a32d-ab5ab17e67b1", "Ponder", "m12 73"}
	snapcaster   = card{"9e5b279e-4670-4a1e-87d0-3cab7e4f9e58", "Snapcaster Mage", "isd 78"}
	murktide     = card{"20c4aae1-7665-4df7-bd51-a1d95bf8a17d", "Murktide Regent", "mh2 52"}
	jace         = card{"0e606072-a3aa-4300-ba90-ec92a721fa76", "Jace, the Mind Sculptor", "wwk 31"}
	island       = card{"91890c11-b139-474d-b12d-6afd6b7e6aee", "Island", "m19 265"}

	thoughtseize  = card{"65b7275a-5305-42e6-b5c3-8b88568b4e28", "Thoughtseize", "ths 107"}
	darkConfidant = card{"94f7a441-bf2d-46fb-a7b6-9bd6137f86d9", "Dark Confidant", "rav 81"}
	grief         = card{"e6befbc4-1320-4f26-bd9f-b1814fedda10", "Grief", "mh2 87"}
	liliana       = card{"ac506c17-adc8-49c6-9d8d-43db7cb1ec9d", "Liliana of the Veil", "isd 105"}
	fatalPush     = card{"b5e81649-9954-424c-89d1-f87d73b66047", "Fatal Push", "aer 57"}
	sheoldred     = card{"d67be074-cdd4-41d9-ac89-0a0456c4e4b2", "Sheoldred, the Apocalypse", "dmu 107"}
	dismember     = card{"064dfdeb-485f-473e-9fa0-8fdb7638cdc6", "Dismember", "nph 57"}

	bolt         = card{"435589bb-27c6-4a6d-9d63-394d5092b9d8", "Lightning Bolt", "m10 146"}
	ragavan      = card{"a9738cda-adb1-47fb-9f4c-ecd930228c4d", "Ragavan, Nimble Pilferer", "mh2 138"}
	fury         = card{"bd281158-8180-40b9-a5b7-03cfc712d81a", "Fury", "mh2 126"}
	shivanDragon = card{"d389b8db-5866-4146-a379-f24b6463622b", "Shivan Dragon", "m19 300"}
	goblinGuide  = card{"b2e2a777-0705-4a37-937d-c6e020ebc0f0", "Goblin Guide", "zen 126"}
	fireball     = card{"1dc84106-aec3-4e52-8dcb-1ed545bf3058", "Fireball", "m10 136"}
	mountain     = card{"71f2030b-f622-4cc3-ac83-258ae3645fd6", "Mountain", "m19 273"}

	llanowarElves = card{"73542493-cd0b-4bb7-a5b8-8f889c76e4d6", "Llanowar Elves", "m19 314"}
	tarmogoyf     = card{"b6876d9e-0908-43ac-8542-09c7aa02b5ba", "Tarmogoyf", "fut 153"}
	craterhoof    = card{"a249be17-73ed-4108-89c0-f7e87939beb8", "Craterhoof Behemoth", "avr 172"}
	birds         = card{"307d4236-1e54-43e3-83f1-063d49d16dda", "Birds of Paradise", "m12 165"}
	primeTitan    = card{"feee9327-b937-46ba-a2aa-6c015ab6cdd5", "Primeval Titan", "m11 192"}
	sylvanLibrary = card{"d5b5d2a7-8185-4df0-a35a-f89c12857f87", "Sylvan Library", "ema 187"}
	forest        = card{"b52ff177-bafe-4e0a-a6c3-2cf012b1319f", "Forest", "m19 277"}
	invasion      = card{"8fed056f-a8f5-41ec-a7d2-a80a238872d1", "Invasion of Zendikar // Awakened Skyclave", "mom 194"}

	helix      = card{"1b2ecf55-c1cc-4b28-b7ce-e1b25305155e", "Lightning Helix", "rav 213"}
	fireIce    = card{"0e09b054-4d33-4a12-bf2a-9b0009f33044", "Fire // Ice", "mh2 290"}
	iteration  = card{"31b770cc-09e7-4c0b-b2a4-462ab4f7200d", "Expressive Iteration", "stx 186"}
	teferi     = card{"5d10b752-d9cb-419d-a5c4-d4ee1acb655e", "Teferi, Hero of Dominaria", "dom 207"}
	nicolBolas = card{"7b215968-93a6-4278-ac61-4e3e8c3c3943", "Nicol Bolas, the Ravager // Nicol Bolas, the Arisen", "m19 218"}

	solRing     = card{"58b26011-e103-45c4-a253-900f4e6b2eeb", "Sol Ring", "cmr 472"}
	wurmcoil    = card{"33672990-4860-4aa6-ac1b-f9da66f5da59", "Wurmcoil Engine", "som 223"}
	emrakul     = card{"67600383-bbb8-411c-b8e6-2296650bc747", "Emrakul, the Aeons Torn", "roe 4"}
	ballista    = card{"329a8738-3e17-403a-857a-0ba529ce8cd1", "Walking Ballista", "aer 181"}
	ornithopter = card{"22bb9825-ad45-44ad-ace2-eb6b66e3f724", "Ornithopter", "m10 216"}
	ugin        = card{"58c1e824-c8a9-4312-8e4c-a29a26d189a4", "Ugin, the Spirit Dragon", "frf 1"}

	pollutedDelta = card{"ff2f5f58-9a95-4ca6-93a0-813738f0072f", "Polluted Delta", "ktk 239"}
	urzasSaga     = card{"c1e0f201-42cb-46a1-901a-65bb4fc18f6c", "Urza's Saga", "mh2 259"}
	fabledPassage = card{"b841bfa8-7c17-4df2-8466-780ab9a4a53a", "Fabled Passage", "eld 244"}
	commandTower  = card{"86424491-a372-40c4-bfb5-faa2b2d41d4c", "Command Tower", "cmr 350"}

	// Foil only, so priced at its foil price.
	propaganda = card{"3e3f0bcd-0796-494d-bf51-94b33c1671e9", "Propaganda", "sld 381"}
	// The "special" rarity (Time Spiral's timeshifted cards). Scryfall's English data has no
	// "bonus" rarity cards, so the seed can't show one.
	darkness = card{"584834fb-b7b6-40eb-9fec-8df17172ce5f", "Darkness", "tsb 40"}
	// No Cardmarket price at all.
	karganDragonrider = card{"7023129c-09f5-49cf-ae32-b9bd30e0ff63", "Kargan Dragonrider", "fdn 762"}
	// Marked as no longer listed by Scryfall (the seed's one change to card data); the next
	// import writes it back. An old reprint, so the Serra Angel above isn't affected.
	revisedSerraAngel = card{"97fa5f07-46ba-408d-a861-bdb1791cc188", "Serra Angel", "3ed 40"}
)

// Shorter names for the entries below.
const (
	nonfoil = contract.FinishNonfoil
	foil    = contract.FinishFoil
	etched  = contract.FinishEtched
	mt      = contract.ConditionMT
	nm      = contract.ConditionNM
	ex      = contract.ConditionEX
	gd      = contract.ConditionGD
	lp      = contract.ConditionLP
	pl      = contract.ConditionPL
	po      = contract.ConditionPO
	en      = contract.LanguageEnglish
	de      = contract.LanguageGerman
	fr      = contract.LanguageFrench
	it      = contract.LanguageItalian
	ja      = contract.LanguageJapanese
)

// More than a page (60) of entries, so the collection's "all" group pages.
var entries = []entry{
	{card: swords, quantity: 2, finish: nonfoil, condition: nm, language: en, in: map[string]int{binder: 1}},
	{card: swords, quantity: 1, finish: etched, condition: nm, language: en},
	{card: wrath, quantity: 1, finish: nonfoil, condition: ex, language: en},
	{card: serraAngel, quantity: 3, finish: nonfoil, condition: nm, language: en, in: map[string]int{box: 3}},
	{card: thalia, quantity: 1, finish: foil, condition: nm, language: en, in: map[string]int{binder: 1}},
	{card: solitude, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: rangerCaptain, quantity: 1, finish: nonfoil, condition: lp, language: en},

	{card: counterspell, quantity: 4, finish: nonfoil, condition: nm, language: en},
	{card: counterspell, quantity: 1, finish: etched, condition: nm, language: en, in: map[string]int{binder: 1}},
	{card: delver, quantity: 2, finish: nonfoil, condition: ex, language: de},
	{card: brainstorm, quantity: 1, finish: foil, condition: nm, language: en},
	{card: ponder, quantity: 4, finish: nonfoil, condition: nm, language: en},
	{card: ponder, quantity: 1, finish: foil, condition: nm, language: en},
	{card: snapcaster, quantity: 1, finish: nonfoil, condition: gd, language: en},
	{card: snapcaster, quantity: 1, finish: foil, condition: ex, language: en},
	{card: murktide, quantity: 2, finish: nonfoil, condition: nm, language: en},
	{card: jace, quantity: 1, finish: nonfoil, condition: pl, language: en},
	{card: island, quantity: 20, finish: nonfoil, condition: nm, language: en, in: map[string]int{box: 10}},
	{card: island, quantity: 4, finish: foil, condition: nm, language: en},

	{card: thoughtseize, quantity: 2, finish: nonfoil, condition: nm, language: en},
	{card: thoughtseize, quantity: 1, finish: foil, condition: nm, language: en},
	{card: darkConfidant, quantity: 1, finish: nonfoil, condition: lp, language: en},
	{card: grief, quantity: 1, finish: foil, condition: nm, language: en},
	{card: liliana, quantity: 1, finish: nonfoil, condition: nm, language: ja},
	{card: fatalPush, quantity: 4, finish: nonfoil, condition: nm, language: en, in: map[string]int{box: 4}},
	{card: sheoldred, quantity: 1, finish: nonfoil, condition: mt, language: en},
	{card: dismember, quantity: 1, finish: nonfoil, condition: ex, language: en},

	// One entry in two groups: a deck can list cards that live in a binder.
	{card: bolt, quantity: 4, finish: nonfoil, condition: nm, language: en, in: map[string]int{deck: 4, binder: 2}},
	{card: bolt, quantity: 1, finish: foil, condition: nm, language: en},
	{card: ragavan, quantity: 1, finish: nonfoil, condition: nm, language: en, in: map[string]int{deck: 1}},
	{card: fury, quantity: 1, finish: nonfoil, condition: nm, language: en, in: map[string]int{deck: 1}},
	{card: shivanDragon, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: goblinGuide, quantity: 4, finish: nonfoil, condition: ex, language: en, in: map[string]int{deck: 4}},
	{card: fireball, quantity: 1, finish: nonfoil, condition: po, language: en},
	{card: mountain, quantity: 20, finish: nonfoil, condition: nm, language: en, in: map[string]int{deck: 16}},

	{card: llanowarElves, quantity: 3, finish: nonfoil, condition: nm, language: en},
	{card: llanowarElves, quantity: 2, finish: nonfoil, condition: nm, language: de},
	{card: tarmogoyf, quantity: 1, finish: nonfoil, condition: ex, language: en},
	{card: craterhoof, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: birds, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: birds, quantity: 2, finish: nonfoil, condition: nm, language: fr},
	{card: primeTitan, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: sylvanLibrary, quantity: 1, finish: foil, condition: nm, language: en},
	{card: forest, quantity: 20, finish: nonfoil, condition: nm, language: en},
	{card: invasion, quantity: 2, finish: nonfoil, condition: nm, language: en},

	{card: helix, quantity: 2, finish: nonfoil, condition: nm, language: en, in: map[string]int{deck: 2}},
	{card: fireIce, quantity: 2, finish: nonfoil, condition: nm, language: en},
	{card: fireIce, quantity: 1, finish: etched, condition: lp, language: en},
	{card: iteration, quantity: 2, finish: nonfoil, condition: nm, language: en},
	{card: teferi, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: nicolBolas, quantity: 1, finish: nonfoil, condition: nm, language: it},

	{card: solRing, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: wurmcoil, quantity: 1, finish: nonfoil, condition: ex, language: en},
	{card: emrakul, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: ballista, quantity: 2, finish: nonfoil, condition: nm, language: en},
	{card: ornithopter, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: ugin, quantity: 1, finish: nonfoil, condition: nm, language: en},

	{card: pollutedDelta, quantity: 2, finish: nonfoil, condition: nm, language: en, in: map[string]int{binder: 2}},
	{card: urzasSaga, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: fabledPassage, quantity: 4, finish: nonfoil, condition: nm, language: en},
	{card: commandTower, quantity: 1, finish: nonfoil, condition: nm, language: en},

	{card: propaganda, quantity: 1, finish: foil, condition: nm, language: en},
	{card: darkness, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: karganDragonrider, quantity: 1, finish: nonfoil, condition: nm, language: en},
	{card: revisedSerraAngel, quantity: 1, finish: nonfoil, condition: gd, language: en, gone: true},
}
