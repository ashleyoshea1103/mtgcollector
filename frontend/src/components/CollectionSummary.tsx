import { COLORS, labelFor, RARITIES } from '../lib/labels';
import type { CollectionStats } from '../types';
import { TotalValue } from './TotalValue';

interface Props {
  stats: CollectionStats;
}

/** Collection totals plus card counts by color and rarity. */
export function CollectionSummary({ stats }: Props) {
  return (
    <section className="collection-summary" aria-label="Collection summary">
      <dl className="collection-summary__totals">
        <div>
          <dt>Cards</dt>
          <dd>{stats.card_count}</dd>
        </div>
        <div>
          <dt>Unique</dt>
          <dd>{stats.unique_cards}</dd>
        </div>
        <div>
          <dt>Value (Cardmarket)</dt>
          <dd>
            <TotalValue total={stats} />
          </dd>
        </div>
      </dl>

      <Breakdown
        title="By color"
        modifier="color"
        rows={Object.entries(stats.by_color).map(([key, count]) => [key, labelFor(COLORS, key), count])}
      />
      <Breakdown
        title="By rarity"
        modifier="rarity"
        rows={Object.entries(stats.by_rarity).map(([key, count]) => [key, labelFor(RARITIES, key), count ?? 0])}
      />
    </section>
  );
}

function Breakdown({ title, modifier, rows }: { title: string; modifier: string; rows: [string, string, number][] }) {
  return (
    <section className={`collection-summary__breakdown collection-summary__breakdown--${modifier}`}>
      <h3>{title}</h3>
      <ul>
        {rows.map(([key, label, count]) => (
          <li key={key} className={`breakdown-item breakdown-item--${key.toLowerCase()}`}>
            <span className="breakdown-item__label">{label}</span>{' '}
            <span className="breakdown-item__count">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
