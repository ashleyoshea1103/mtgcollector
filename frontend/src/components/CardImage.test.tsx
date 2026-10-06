import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards } from '../fixtures';
import { CardImage } from './CardImage';

describe('CardImage', () => {
  it('shows the requested size of a single-faced card', () => {
    render(<CardImage card={cards.lightningBolt} size="small" />);
    const img = screen.getByRole('img', { name: 'Lightning Bolt' });
    expect(img).toHaveAttribute('src', cards.lightningBolt.images!.small);
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('shows each face of a transforming card', () => {
    render(
      <>
        <CardImage card={cards.delver} face={0} />
        <CardImage card={cards.delver} face={1} />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Delver of Secrets' })).toHaveAttribute('src', expect.stringContaining('/front/'));
    expect(screen.getByRole('img', { name: 'Insectile Aberration' })).toHaveAttribute('src', expect.stringContaining('/back/'));
  });

  it('uses the shared image for split cards, whose faces have no images', () => {
    render(<CardImage card={cards.fireIce} face={1} />);
    expect(screen.getByRole('img', { name: 'Fire // Ice' })).toHaveAttribute('src', cards.fireIce.images!.normal);
  });

  it('shows a named placeholder when there is no image', () => {
    render(<CardImage card={{ ...cards.lightningBolt, images: null }} />);
    const placeholder = screen.getByRole('img', { name: 'Lightning Bolt' });
    expect(placeholder.tagName).toBe('DIV');
    expect(placeholder).toHaveTextContent('Lightning Bolt');
  });
});
