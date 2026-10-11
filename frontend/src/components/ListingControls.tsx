import { GROUP_BY_LABELS, SORT_LABELS, VIEW_LABELS, type ListingParams } from '../lib/listingParams';
import type { GroupBy, SortBy } from '../types';
import { Cluster, Field, SegmentedControl, Select } from '../ui';
import type { CollectionView } from './GroupBucketSection';

interface Props {
  value: ListingParams;
  onChange: (value: ListingParams) => void;
}

const options = <T extends string>(labels: Record<T, string>) => (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
const GROUP_BY_OPTIONS = options<GroupBy>(GROUP_BY_LABELS);
const SORT_OPTIONS = options<SortBy>(SORT_LABELS);
const VIEW_OPTIONS = options<CollectionView>(VIEW_LABELS);

/** How a listing of cards is grouped, sorted and shown (grid or list). */
export function ListingControls({ value, onChange }: Props) {
  return (
    <Cluster className="listing-controls" gap={4}>
      <Field label="Group by" className="listing-controls__group-by">
        <Select options={GROUP_BY_OPTIONS} value={value.groupBy} onChange={(groupBy) => onChange({ ...value, groupBy })} />
      </Field>
      <Field label="Sort by" className="listing-controls__sort">
        <Select options={SORT_OPTIONS} value={value.sort} onChange={(sort) => onChange({ ...value, sort })} />
      </Field>
      <SegmentedControl label="View" className="listing-controls__view" options={VIEW_OPTIONS} value={value.view} onChange={(view) => onChange({ ...value, view })} />
    </Cluster>
  );
}
