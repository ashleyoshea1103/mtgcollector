import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { colorBuckets } from '../fixtures';
import { GroupBucketSection } from './GroupBucketSection';

const red = colorBuckets.find((b) => b.key === 'R')!;

describe('GroupBucketSection', () => {
  it('heads the section with its label, card count and value', () => {
    render(<GroupBucketSection bucket={red} />);
    expect(screen.getByRole('heading', { name: 'Red' })).toBeInTheDocument();
    expect(screen.getByText('5 cards')).toBeInTheDocument();
    expect(screen.getByText(/60[.,]12/)).toBeInTheDocument();
  });

  it('uses the singular for one card', () => {
    render(<GroupBucketSection bucket={colorBuckets.find((b) => b.key === 'G')!} />);
    expect(screen.getByText('1 card')).toBeInTheDocument();
  });

  it('shows entries as tiles in grid view', () => {
    render(<GroupBucketSection bucket={red} view="grid" />);
    expect(screen.getAllByRole('article')).toHaveLength(red.entries.length);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows entries as table rows in list view', () => {
    render(<GroupBucketSection bucket={red} view="list" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getAllByRole('rowheader')).toHaveLength(red.entries.length);
  });

  it('collapses and expands when the header is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<GroupBucketSection bucket={red} />);
    const details = container.querySelector('details')!;
    expect(details).toHaveAttribute('open');
    await user.click(screen.getByRole('heading', { name: 'Red' }));
    expect(details).not.toHaveAttribute('open');
    await user.click(screen.getByRole('heading', { name: 'Red' }));
    expect(details).toHaveAttribute('open');
  });

  it('can start collapsed', () => {
    const { container } = render(<GroupBucketSection bucket={red} defaultOpen={false} />);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });
});
