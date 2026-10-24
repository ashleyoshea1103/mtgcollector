import { useState } from 'react';
import { AddToCollectionForm } from '../components/AddToCollectionForm';
import { AuthForm } from '../components/AuthForm';
import { CardDetail } from '../components/CardDetail';
import { CardImage } from '../components/CardImage';
import { CardTile } from '../components/CardTile';
import { CardViewer } from '../components/CardViewer';
import { CollectionEntryTable } from '../components/CollectionEntryTable';
import { CollectionEntryTile } from '../components/CollectionEntryTile';
import { CollectionSummary } from '../components/CollectionSummary';
import { CustomGroupCard } from '../components/CustomGroupCard';
import { EntryChangeForm } from '../components/EntryChangeForm';
import { GroupForm } from '../components/GroupForm';
import { GroupBucketSection, type CollectionView } from '../components/GroupBucketSection';
import { ListingControls } from '../components/ListingControls';
import { ManaCost } from '../components/ManaCost';
import { MemberForm } from '../components/MemberForm';
import { Price } from '../components/Price';
import { RateNote } from '../components/RateNote';
import { PrintingOption } from '../components/PrintingOption';
import { RarityBadge } from '../components/RarityBadge';
import { SearchFilters } from '../components/SearchFilters';
import { SetSymbol } from '../components/SetSymbol';
import type { CardSearch } from '../api/endpoints';
import { DEFAULT_LISTING, type ListingParams } from '../lib/listingParams';
import { EMPTY_SEARCH } from '../lib/search';
import { MoneyContext, type Money } from '../lib/money';
import { DEV_ONLY_MARKER } from '../devOnly';
import { cards, colorGroups, customGroups, entries, setGroup, stats, unlistedCard, unpricedCard } from '../fixtures';
import type { Card, NewEntry } from '../types';
import { Field, Grid, SegmentedControl, Select } from '../ui';
import { PRIMITIVE_SECTIONS, slug } from './gallerySections';
import { PrimitivesGallery, Section } from './PrimitivesGallery';

const allCards = [...Object.values(cards), unpricedCard, unlistedCard];
const allEntries = Object.values(entries);
const imageless: Card = { ...cards.lightningBolt, id: 'imageless', images: null };

// How prices are shown, in each state, for the gallery's examples (the app's comes from the server's rate).
const IN_EUROS: Money = { chosen: 'eur', currency: 'eur', gbpPerEur: null, rateDate: null, rateStatus: 'unavailable', choose: () => {} };
const IN_POUNDS: Money = { ...IN_EUROS, chosen: 'gbp', currency: 'gbp', gbpPerEur: 0.8712, rateDate: '2026-10-09', rateStatus: 'ready' };
const NO_RATE: Money = { ...IN_EUROS, chosen: 'gbp' };

/** Every presentational component rendered with fixture data, then every src/ui primitive, for review before styling. */
export function ComponentGallery() {
  const [view, setView] = useState<CollectionView>('grid');
  const [printing, setPrinting] = useState(allCards[0].id);
  const [detailKey, setDetailKey] = useState<keyof typeof cards>('delver');
  const [viewing, setViewing] = useState<Card | null>(null);
  const [submitted, setSubmitted] = useState<NewEntry | null>(null);
  const [formOutput, setFormOutput] = useState<unknown>(null);
  const [search, setSearch] = useState<CardSearch>(EMPTY_SEARCH);
  const [listing, setListing] = useState<ListingParams>(DEFAULT_LISTING);
  const [memberGroup, setMemberGroup] = useState(customGroups[0].id);

  return (
    <main className="gallery" data-dev-only={DEV_ONLY_MARKER}>
      <h1>Component gallery</h1>
      <p>Each component shown with real Scryfall fixture data. Styling is intentionally minimal.</p>
      <nav className="gallery__toc" aria-label="Sections">
        {[...SECTIONS, ...PRIMITIVE_SECTIONS].map((s) => (
          <a key={s} href={`#${slug(s)}`}>
            {s}
          </a>
        ))}
      </nav>

      <Section name="CardImage" note="Sizes small and normal, both faces of a transforming card, and the no-image placeholder.">
        <div className="gallery__row">
          <CardImage card={cards.lightningBolt} size="small" />
          <CardImage card={cards.lightningBolt} />
          <CardImage card={cards.delver} face={0} />
          <CardImage card={cards.delver} face={1} />
          <CardImage card={imageless} />
        </div>
      </Section>

      <Section name="ManaCost / SetSymbol / RarityBadge">
        <ul>
          {allCards.map((c) => (
            <li key={c.id}>
              {c.name}: <ManaCost cost={c.mana_cost} /> <SetSymbol set={c.set} rarity={c.rarity} /> <RarityBadge rarity={c.rarity} />
            </li>
          ))}
          <li>
            Hybrid and generic: <ManaCost cost="{X}{2}{W/U}{B/P}" />
          </li>
        </ul>
      </Section>

      <Section name="Price" note={`Foil falls back to the non-foil price when there's no foil price; etched USD uses the etched price; missing prices show a dash. A price for one copy says "each"; among pounds, only to screen readers.`}>
        <ul>
          <li>
            Ragavan non-foil: <Price prices={cards.ragavan.prices} />
          </li>
          <li>
            Ragavan foil: <Price prices={cards.ragavan.prices} finish="foil" />
          </li>
          <li>
            Ragavan foil USD: <Price prices={cards.ragavan.prices} finish="foil" currency="usd" />
          </li>
          <li>
            Fire // Ice etched USD: <Price prices={cards.fireIce.prices} finish="etched" currency="usd" />
          </li>
          <li>
            Unpriced Llanowar Elves: <Price prices={unpricedCard.prices} />
          </li>
          <li>
            Ragavan non-foil, one copy: <Price prices={cards.ragavan.prices} each />
          </li>
          <MoneyContext value={IN_POUNDS}>
            <li>
              Ragavan non-foil, in pounds: <Price prices={cards.ragavan.prices} />
            </li>
            <li>
              Ragavan foil USD, with pounds chosen (dollars stay): <Price prices={cards.ragavan.prices} finish="foil" currency="usd" />
            </li>
            <li>
              Unpriced Llanowar Elves, in pounds: <Price prices={unpricedCard.prices} />
            </li>
            <li>
              Ragavan non-foil, one copy, in pounds ("each" is read out, not shown): <Price prices={cards.ragavan.prices} each />
            </li>
          </MoneyContext>
        </ul>
      </Section>

      <Section name="RateNote" note="Once on each page that shows prices: where pounds come from, or why prices are in euros.">
        <MoneyContext value={IN_POUNDS}>
          <RateNote />
        </MoneyContext>
        <MoneyContext value={NO_RATE}>
          <RateNote />
        </MoneyContext>
        <MoneyContext value={IN_EUROS}>
          <RateNote euros="Values from Cardmarket, in euros" />
        </MoneyContext>
      </Section>

      <Section name="CardTile" note="Search result shape, with an action slot. Each image opens the larger view (CardViewer). Foil-only Propaganda is priced at its foil price; the last Ragavan is a printing Scryfall no longer lists.">
        <Grid minItemWidth="180px" className="entry-grid">
          {allCards.map((c) => (
            <CardTile key={c.id} card={c} onView={() => setViewing(c)} actions={<button type="button">Add</button>} />
          ))}
        </Grid>
      </Section>

      <Section name="CardViewer" note="A card shown large, opened from a tile's image (above). Double-faced Delver turns over; a page gives it the whole card, fetched on opening.">
        <Grid minItemWidth="180px" className="entry-grid">
          {[cards.lightningBolt, cards.delver].map((c) => (
            <CardTile key={c.id} card={c} price={null} onView={() => setViewing(c)} />
          ))}
        </Grid>
        {viewing && (
          <CardViewer
            key={viewing.id}
            card={viewing}
            isOpen
            onOpenChange={(open) => {
              if (!open) setViewing(null);
            }}
            details={<a href={`#${slug('CardDetail')}`}>Card details</a>}
          />
        )}
      </Section>

      <Section name="PrintingOption" note="Click to select. The last is a printing Scryfall no longer lists.">
        <div className="printing-list">
          {allCards.map((c) => (
            <PrintingOption key={c.id} card={c} selected={printing === c.id} onSelect={(card) => setPrinting(card.id)} />
          ))}
        </div>
      </Section>

      <Section name="CollectionEntryTile" note="4× Bolt, foil Ragavan, German EX Delver, etched LP Fire // Ice, foil-only Propaganda, 3× unpriced Llanowar Elves.">
        <Grid minItemWidth="180px" className="entry-grid">
          {allEntries.map((e) => (
            <CollectionEntryTile key={e.id} entry={e} />
          ))}
        </Grid>
      </Section>

      <Section name="CollectionEntryTable">
        <CollectionEntryTable entries={allEntries} renderActions={() => <button type="button">Remove</button>} />
      </Section>

      <Section name="GroupBucketSection" note="The collection grouped by color. Green has only unpriced cards; Trade binder below is partly unpriced. The last color group starts closed; after them, a group from grouping by set.">
        <SegmentedControl
          label="View"
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
          ]}
          value={view}
          onChange={setView}
        />
        {colorGroups.map(({ group, entries }, i) => (
          <GroupBucketSection key={group.key} group={group} entries={entries} view={view} defaultOpen={i < colorGroups.length - 1} />
        ))}
        <GroupBucketSection {...setGroup} view={view} />
      </Section>

      <Section name="CustomGroupCard" note="A binder, a deck and an empty box.">
        <Grid minItemWidth="260px" className="group-grid">
          {customGroups.map((g) => (
            <CustomGroupCard key={g.id} group={g} actions={<button type="button">Open</button>} />
          ))}
        </Grid>
      </Section>

      <Section name="CollectionSummary">
        <CollectionSummary stats={stats} />
      </Section>

      <Section name="CardDetail">
        <Field label="Card">
          <Select options={Object.entries(cards).map(([key, c]) => ({ value: key as keyof typeof cards, label: c.name }))} value={detailKey} onChange={setDetailKey} />
        </Field>
        <CardDetail card={cards[detailKey]} entries={allEntries.filter((e) => e.card.id === cards[detailKey].id)} />
      </Section>

      <Section name="AddToCollectionForm" note="Fire // Ice offers all three finishes. Submitting shows the payload.">
        <AddToCollectionForm card={cards.fireIce} groups={customGroups} onSubmit={setSubmitted} />
        {submitted && <pre className="gallery__output">{JSON.stringify(submitted, null, 2)}</pre>}
      </Section>

      <Section name="SearchFilters" note="Text is reported once typing pauses; the search below is what the page would send.">
        <SearchFilters value={search} onChange={setSearch} />
        <pre className="gallery__output">{JSON.stringify(search, null, 2)}</pre>
      </Section>

      <Section name="ListingControls">
        <ListingControls value={listing} onChange={setListing} />
        <pre className="gallery__output">{JSON.stringify(listing)}</pre>
      </Section>

      <Section name="AuthForm" note="Signing up checks the password's length before sending it; the second shows a server error.">
        <Grid minItemWidth="260px">
          <AuthForm mode="signup" onSubmit={(c) => setFormOutput({ ...c, password: '…' })} />
          <AuthForm mode="login" onSubmit={() => {}} error="Email or password is incorrect." />
        </Grid>
      </Section>

      <Section name="GroupForm" note="Making a group, and changing one.">
        <Grid minItemWidth="260px">
          <GroupForm onSubmit={setFormOutput} />
          <GroupForm group={customGroups[0]} onSubmit={setFormOutput} onCancel={() => setFormOutput(null)} />
        </Grid>
      </Section>

      <Section name="EntryChangeForm" note="Sends only what changed.">
        <EntryChangeForm entry={entries.germanDelver} onSubmit={setFormOutput} onCancel={() => setFormOutput(null)} />
      </Section>

      <Section name="MemberForm" note="Copies of 4 × Lightning Bolt in a group; Izzet Tempo holds 2 already.">
        <MemberForm
          entry={entries.bolts}
          groups={customGroups}
          groupId={memberGroup}
          onGroupChange={setMemberGroup}
          current={memberGroup === customGroups[1].id ? 2 : null}
          onSubmit={(quantity) => setFormOutput({ group: memberGroup, quantity })}
        />
        {formOutput !== null && <pre className="gallery__output">{JSON.stringify(formOutput, null, 2)}</pre>}
      </Section>

      <PrimitivesGallery />
    </main>
  );
}

const SECTIONS = [
  'CardImage',
  'ManaCost / SetSymbol / RarityBadge',
  'Price',
  'RateNote',
  'CardTile',
  'CardViewer',
  'PrintingOption',
  'CollectionEntryTile',
  'CollectionEntryTable',
  'GroupBucketSection',
  'CustomGroupCard',
  'CollectionSummary',
  'CardDetail',
  'AddToCollectionForm',
  'SearchFilters',
  'ListingControls',
  'AuthForm',
  'GroupForm',
  'EntryChangeForm',
  'MemberForm',
];
