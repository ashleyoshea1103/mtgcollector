import { useState } from 'react';
import { AddToCollectionForm } from '../components/AddToCollectionForm';
import { CardDetail } from '../components/CardDetail';
import { CardImage } from '../components/CardImage';
import { CardTile } from '../components/CardTile';
import { CollectionEntryTable } from '../components/CollectionEntryTable';
import { CollectionEntryTile } from '../components/CollectionEntryTile';
import { CollectionSummary } from '../components/CollectionSummary';
import { CustomGroupCard } from '../components/CustomGroupCard';
import { GroupBucketSection, type CollectionView } from '../components/GroupBucketSection';
import { ManaCost } from '../components/ManaCost';
import { Price } from '../components/Price';
import { PrintingOption } from '../components/PrintingOption';
import { RarityBadge } from '../components/RarityBadge';
import { SetSymbol } from '../components/SetSymbol';
import { DEV_ONLY_MARKER } from '../devOnly';
import { cards, colorGroups, customGroups, entries, setGroup, stats, unpricedCard } from '../fixtures';
import type { Card, NewEntry } from '../types';
import { Field, Grid, SegmentedControl, Select } from '../ui';
import { PRIMITIVE_SECTIONS, slug } from './gallerySections';
import { PrimitivesGallery, Section } from './PrimitivesGallery';

const allCards = [...Object.values(cards), unpricedCard];
const allEntries = Object.values(entries);
const imageless: Card = { ...cards.lightningBolt, id: 'imageless', images: null };

/** Every presentational component rendered with fixture data, then every src/ui primitive, for review before styling. */
export function ComponentGallery() {
  const [view, setView] = useState<CollectionView>('grid');
  const [printing, setPrinting] = useState(allCards[0].id);
  const [detailKey, setDetailKey] = useState<keyof typeof cards>('delver');
  const [submitted, setSubmitted] = useState<NewEntry | null>(null);

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

      <Section name="Price" note="Foil falls back to the non-foil price when there's no foil price; etched USD uses the etched price; missing prices show a dash.">
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
        </ul>
      </Section>

      <Section name="CardTile" note="Search result shape, with an action slot. Foil-only Propaganda is priced at its foil price.">
        <Grid minItemWidth="180px" className="entry-grid">
          {allCards.map((c) => (
            <CardTile key={c.id} card={c} actions={<button type="button">Add</button>} />
          ))}
        </Grid>
      </Section>

      <Section name="PrintingOption" note="Click to select.">
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

      <PrimitivesGallery />
    </main>
  );
}

const SECTIONS = [
  'CardImage',
  'ManaCost / SetSymbol / RarityBadge',
  'Price',
  'CardTile',
  'PrintingOption',
  'CollectionEntryTile',
  'CollectionEntryTable',
  'GroupBucketSection',
  'CustomGroupCard',
  'CollectionSummary',
  'CardDetail',
  'AddToCollectionForm',
];
