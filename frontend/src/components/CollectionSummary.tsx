import { COLORS, RARITIES } from '../lib/labels';
import type { CollectionStats, Rarity } from '../types';
import { Price } from './Price';

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
          <dd>{stats.total_cards}</dd>
        </div>
        <div>
          <dt>Unique</dt>
          <dd>{stats.unique_cards}</dd>
        </div>
        <div>
          <dt>Value (Cardmarket)</dt>
          <dd>
            <Price value={stats.value_eur} />
          </dd>
        </div>
        <div>
          <dt>Value (USD)</dt>
          <dd>
            <Price value={stats.value_usd} currency="usd" />
          </dd>
        </div>
      </dl>

      <Breakdown
        title="By color"
        modifier="color"
        rows={Object.entries(stats.by_color).map(([key, count]) => [key, COLORS[key] ?? key, count])}
      />
      <Breakdown
        title="By rarity"
        modifier="rarity"
        rows={Object.entries(stats.by_rarity).map(([key, count]) => [key, RARITIES[key as Rarity], count ?? 0])}
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
