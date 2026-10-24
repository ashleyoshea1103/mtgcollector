import type { CardSearch } from '../api/endpoints';
import { COLORS, labelFor, RARITIES } from '../lib/labels';
import { isSetCode, SEARCH_COLORS } from '../lib/search';
import { MaxSearchLength, type Rarity } from '../types';
import { Checkbox, Cluster, Field, SearchInput, Select } from '../ui';
import { ManaSymbol } from './ManaSymbol';

interface Props {
  /** The search as it stands; text fields start from it and then keep what's typed. */
  value: CardSearch;
  onChange: (value: CardSearch) => void;
}

const RARITY_OPTIONS = [{ value: '' as const, label: 'Any' }, ...Object.entries(RARITIES).map(([value, label]) => ({ value: value as Rarity, label }))];

/**
 * A card search: the name, and filters for set, type, rarity and colors. Text is reported
 * once typing pauses; the other filters at once.
 */
export function SearchFilters({ value, onChange }: Props) {
  const set = (change: Partial<CardSearch>) => onChange({ ...value, ...change });
  const colorless = value.colors === 'C';
  const badSet = value.set !== '' && !isSetCode(value.set);

  function toggleColor(color: string, on: boolean) {
    const chosen = new Set(colorless ? [] : value.colors.split(''));
    if (on) chosen.add(color);
    else chosen.delete(color);
    set({ colors: SEARCH_COLORS.filter((c) => chosen.has(c)).join('') });
  }

  return (
    // role="search" rather than <search>, which older screen readers don't know as a landmark.
    <div className="search-filters" role="search">
      <Field label="Card name">
        <SearchInput defaultValue={value.q} maxLength={MaxSearchLength} onSearch={(q) => set({ q })} placeholder="e.g. lightning bolt" />
      </Field>
      <Cluster className="search-filters__more" gap={4}>
        <Field label="Set code" error={badSet ? 'A set code is letters and digits, like mh2.' : undefined}>
          <SearchInput defaultValue={value.set} maxLength={8} onSearch={(code) => set({ set: code.trim().toLowerCase() })} placeholder="e.g. mh2" />
        </Field>
        <Field label="Type">
          <SearchInput defaultValue={value.type} maxLength={MaxSearchLength} onSearch={(type) => set({ type })} placeholder="e.g. creature elf" />
        </Field>
        <Field label="Rarity">
          <Select options={RARITY_OPTIONS} value={value.rarity} onChange={(rarity) => set({ rarity })} />
        </Field>
      </Cluster>
      <fieldset className="search-filters__colors">
        <legend>Colors (all of)</legend>
        <Cluster>
          {SEARCH_COLORS.map((c) => (
            <Checkbox key={c} className="search-filters__color" checked={!colorless && value.colors.includes(c)} onChange={(on) => toggleColor(c, on)}>
              <ManaSymbol symbol={c} announce={false} /> {labelFor(COLORS, c)}
            </Checkbox>
          ))}
          <Checkbox className="search-filters__color" checked={colorless} onChange={(on) => set({ colors: on ? 'C' : '' })}>
            <ManaSymbol symbol="C" announce={false} /> {labelFor(COLORS, 'C')}
          </Checkbox>
        </Cluster>
      </fieldset>
      <Checkbox checked={value.extras} onChange={(extras) => set({ extras })}>
        Include tokens, emblems and other non-game cards
      </Checkbox>
    </div>
  );
}
