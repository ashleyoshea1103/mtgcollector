import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, entries } from '../fixtures';
import { CardDetail } from './CardDetail';

describe('CardDetail', () => {
  it('shows both faces of a transforming card, with images and rules text', () => {
    render(<CardDetail card={cards.delver} />);
    expect(screen.getByRole('img', { name: 'Delver of Secrets' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Insectile Aberration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Insectile Aberration/, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Flying')).toBeInTheDocument();
  });

  it('shows one image but both halves of a split card', () => {
    render(<CardDetail card={cards.fireIce} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /^Fire/, level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Ice/, level: 3 })).toBeInTheDocument();
  });

  it('shows the rules text of a single-faced card', () => {
    render(<CardDetail card={cards.lightningBolt} />);
    expect(screen.getByText(/deals 3 damage/)).toBeInTheDocument();
  });

  it('links to Cardmarket in a new tab', () => {
    render(<CardDetail card={cards.ragavan} />);
    const link = screen.getByRole('link', { name: 'View on Cardmarket' });
    expect(link).toHaveAttribute('href', cards.ragavan.cardmarket_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('has no Cardmarket link when Scryfall has none', () => {
    render(<CardDetail card={{ ...cards.ragavan, cardmarket_url: null }} />);
    expect(screen.queryByRole('link', { name: 'View on Cardmarket' })).not.toBeInTheDocument();
  });

  it('lists the copies the user owns', () => {
    render(<CardDetail card={cards.delver} entries={[entries.germanDelver]} />);
    expect(screen.getByRole('heading', { name: 'In your collection' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('2× Non-foil, Excellent, German');
  });

  it('omits the owned section when the user has no copies', () => {
    render(<CardDetail card={cards.delver} />);
    expect(screen.queryByRole('heading', { name: 'In your collection' })).not.toBeInTheDocument();
  });
});
