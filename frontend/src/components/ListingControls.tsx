import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { GROUP_BY_LABELS, normaliseSearch, SORT_LABELS, VIEW_LABELS, type ListingParams } from '../lib/listingParams';
import { MaxSearchLength, type GroupBy, type SortBy } from '../types';
import { Cluster, Field, SearchInput, SegmentedControl, Select } from '../ui';
import type { CollectionView } from './GroupBucketSection';

interface Props {
  value: ListingParams;
  onChange: (value: ListingParams) => void;
}

const options = <T extends string>(labels: Record<T, string>) => (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
const GROUP_BY_OPTIONS = options<GroupBy>(GROUP_BY_LABELS);
const SORT_OPTIONS = options<SortBy>(SORT_LABELS);
const VIEW_OPTIONS = options<CollectionView>(VIEW_LABELS);

/** How a listing of cards is grouped, sorted, searched and shown (grid or list). */
export function ListingControls({ value, onChange }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  useToolbarHeight(bar);
  const search = useSearchBox(value.q);
  return (
    // The bar stays at the top of the screen while the cards scroll (src/index.css).
    <div ref={bar} className="listing-controls">
      <Cluster className="listing-controls__bar" gap={4}>
      <Field label="Group by" className="listing-controls__group-by">
        <Select options={GROUP_BY_OPTIONS} value={value.groupBy} onChange={(groupBy) => onChange({ ...value, groupBy })} />
      </Field>
      <Field label="Sort by" className="listing-controls__sort">
        <Select options={SORT_OPTIONS} value={value.sort} onChange={(sort) => onChange({ ...value, sort })} />
      </Field>
        <Field label="Search" className="listing-controls__search">
          <SearchInput
            key={search.key}
            defaultValue={value.q}
            maxLength={MaxSearchLength}
            placeholder="Name or type"
            onSearch={(text) => onChange({ ...value, q: search.reported(normaliseSearch(text)) })}
          />
        </Field>
        <SegmentedControl label="View" className="listing-controls__view" options={VIEW_OPTIONS} value={value.view} onChange={(view) => onChange({ ...value, view })} />
      </Cluster>
    </div>
  );
}

/**
 * The search box keeps what's typed, and the page writes it to the URL. A search the box didn't
 * report (the nav link back to an unsearched listing, say) starts it afresh, by a new key. Its
 * own reports come back a render or more later, maybe after more typing, so they're recognised
 * when they arrive rather than assumed at once.
 */
function useSearchBox(q: string) {
  const [box, setBox] = useState<{ key: number; q: string; pending: string[] }>({ key: 0, q, pending: [] });
  if (q !== box.q) {
    const own = box.pending.indexOf(q);
    setBox(own >= 0 ? { ...box, q, pending: box.pending.slice(own + 1) } : { key: box.key + 1, q, pending: [] });
  }
  return {
    key: box.key,
    /** Records a search the box reported, and returns it. */
    reported: (text: string) => {
      setBox((b) => ({ ...b, pending: [...b.pending, text] }));
      return text;
    },
  };
}

/**
 * Keeps --toolbar-height at the bar's height while it's shown, so the listing's section
 * headings stick just below it however its controls wrap (taller on a phone, where the labels
 * go above). Without a ResizeObserver the stylesheet's typical height stands.
 */
function useToolbarHeight(bar: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--toolbar-height', `${element.getBoundingClientRect().height}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--toolbar-height');
    };
  }, [bar]);
}
