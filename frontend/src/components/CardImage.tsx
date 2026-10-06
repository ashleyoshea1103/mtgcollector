import type { Card, CardSummary, ImageSize } from '../types';

interface Props {
  /** A summary only has the front image; pass the full Card to show other faces. */
  card: CardSummary | Card;
  size?: ImageSize;
  /** Which face to show for double-faced cards. Defaults to the front. */
  face?: number;
  className?: string;
}

/** A Scryfall card image, or a placeholder with the card name when there is none. */
export function CardImage({ card, size = 'normal', face = 0, className = '' }: Props) {
  const faceData = 'faces' in card ? card.faces?.[face] : undefined;
  const src = (faceData?.images ?? card.images)?.[size];
  const alt = faceData?.images ? faceData.name : card.name;

  if (!src) {
    return (
      <div className={`card-image card-image--missing card-image--${size} ${className}`} role="img" aria-label={alt}>
        {alt}
      </div>
    );
  }

  return (
    <img
      className={`card-image card-image--${size} ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
