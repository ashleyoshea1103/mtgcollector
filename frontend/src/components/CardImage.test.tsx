import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards } from '../fixtures';
import type { CardSummary } from '../types';
import { CardImage } from './CardImage';

const { lightningBolt, delver, fireIce, propaganda } = cards;

describe('CardImage', () => {
  it('shows the requested size of a single-faced card, lazily', () => {
    render(<CardImage card={lightningBolt} size="small" />);
    const img = screen.getByRole('img', { name: 'Lightning Bolt' });
    expect(img).toHaveAttribute('src', lightningBolt.images!.small);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
  });

  it('shows each face of a transforming card at the requested size', () => {
    render(
      <>
        <CardImage card={delver} face={0} size="large" />
        <CardImage card={delver} face={1} size="large" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Delver of Secrets' })).toHaveAttribute('src', delver.faces![0].images!.large);
    expect(screen.getByRole('img', { name: 'Insectile Aberration' })).toHaveAttribute('src', delver.faces![1].images!.large);
  });

  it('shows the back of a reversible card', () => {
    render(<CardImage card={propaganda} face={1} size="small" />);
    expect(screen.getByRole('img', { name: 'Propaganda' })).toHaveAttribute('src', propaganda.faces![1].images!.small);
  });

  it('uses the shared image for split cards, whose faces have no images', () => {
    render(<CardImage card={fireIce} face={1} />);
    expect(screen.getByRole('img', { name: 'Fire // Ice' })).toHaveAttribute('src', fireIce.images!.normal);
  });

  it('shows the front image for a card summary, which has no faces', () => {
    const { faces: _faces, oracle_text: _text, cardmarket_url: _url, ...summary } = delver;
    render(<CardImage card={summary satisfies CardSummary} face={1} />);
    expect(screen.getByRole('img', { name: delver.name })).toHaveAttribute('src', delver.images!.normal);
  });

  it('shows a named placeholder when there is no image', () => {
    render(<CardImage card={{ ...lightningBolt, images: null }} />);
    const placeholder = screen.getByRole('img', { name: 'Lightning Bolt' });
    expect(placeholder.tagName).toBe('DIV');
    expect(placeholder).toHaveTextContent('Lightning Bolt');
  });
});
