import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import type { Card, CardFace, CollectionEntry } from '../types';
import { CardImage } from './CardImage';
import { ManaCost } from './ManaCost';
import { Price } from './Price';
import { RarityBadge } from './RarityBadge';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: Card;
  /** The user's copies of this printing, if any. */
  entries?: CollectionEntry[];
}

/** Everything about one printing: images, rules text, prices and owned copies. */
export function CardDetail({ card, entries = [] }: Props) {
  // Transform/modal cards have an image per face; split and adventure cards share one.
  const faceImages = card.faces?.filter((f) => f.images).length ?? 0;
  const faces: CardFace[] = card.faces ?? [
    { name: card.name, mana_cost: card.mana_cost, type_line: card.type_line, oracle_text: card.oracle_text ?? undefined, images: null },
  ];

  return (
    <article className="card-detail">
      <div className="card-detail__images">
        {faceImages > 1 ? (
          card.faces!.map((_, i) => <CardImage key={i} card={card} face={i} size="large" />)
        ) : (
          <CardImage card={card} size="large" />
        )}
      </div>

      <div className="card-detail__info">
        <header className="card-detail__header">
          <h2 className="card-detail__name">{card.name}</h2>
          <p className="card-detail__printing">
            <SetSymbol set={card.set} rarity={card.rarity} nameShown /> {card.set.name} #{card.collector_number} <RarityBadge rarity={card.rarity} />{' '}
            <time dateTime={card.released_at}>{card.released_at}</time>
          </p>
        </header>

        {faces.map((face, i) => (
          <section key={i} className="card-detail__face">
            <h3 className="card-detail__face-name">
              {face.name} <ManaCost cost={face.mana_cost} />
            </h3>
            <p className="card-detail__type">{face.type_line}</p>
            {face.oracle_text && <p className="card-detail__oracle">{face.oracle_text}</p>}
          </section>
        ))}

        <section className="card-detail__prices">
          <h3>Prices</h3>
          <table>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">EUR (Cardmarket)</th>
                <th scope="col">USD</th>
              </tr>
            </thead>
            <tbody>
              {card.finishes.map((finish) => (
                <tr key={finish}>
                  <th scope="row">{labelFor(FINISHES, finish)}</th>
                  <td>
                    <Price prices={card.prices} finish={finish} />
                  </td>
                  <td>
                    <Price prices={card.prices} finish={finish} currency="usd" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {card.cardmarket_url && (
            <a className="card-detail__cardmarket" href={card.cardmarket_url} target="_blank" rel="noopener noreferrer">
              View on Cardmarket
            </a>
          )}
        </section>

        {entries.length > 0 && (
          <section className="card-detail__owned">
            <h3>In your collection</h3>
            <ul>
              {entries.map((e) => (
                <li key={e.id}>
                  {e.quantity}× {labelFor(FINISHES, e.finish)}, {labelFor(CONDITIONS, e.condition)}, {labelFor(LANGUAGES, e.language)}{' '}
                  <Price value={e.value_eur} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
