import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { colorGroups, makeGroup } from '../fixtures';
import { eur } from '../test/helpers';
import { GroupBucketSection } from './GroupBucketSection';

const red = colorGroups.find(({ group }) => group.key === 'R')!;
const green = colorGroups.find(({ group }) => group.key === 'G')!;
const toggle = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

describe('GroupBucketSection', () => {
  it('heads the section with its label, card count and value', () => {
    render(<GroupBucketSection {...red} />);
    expect(screen.getByRole('heading', { name: /^Red/ })).toBeInTheDocument();
    expect(toggle('Red')).toHaveTextContent(`${red.group.card_count} cards`);
    expect(toggle('Red')).toHaveTextContent(eur(red.group.value_eur));
  });

  it('counts cards with the right plural', () => {
    const one = makeGroup('X', 'One', red.entries.slice(1)); // a single foil Ragavan
    const none = makeGroup('Y', 'None', []);
    render(
      <>
        <GroupBucketSection {...one} />
        <GroupBucketSection {...none} />
      </>,
    );
    expect(toggle('One')).toHaveTextContent('1 card');
    expect(toggle('One')).not.toHaveTextContent('1 cards');
    expect(toggle('None')).toHaveTextContent('0 cards');
  });

  it('shows a dash rather than €0 for a group with no prices', () => {
    render(<GroupBucketSection {...green} />);
    expect(within(toggle('Green')).getByTitle('No price available')).toBeInTheDocument();
  });

  it('shows entries as tiles in grid view', () => {
    render(<GroupBucketSection {...red} view="grid" />);
    expect(screen.getAllByRole('article')).toHaveLength(red.entries.length);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows entries as table rows in list view', () => {
    render(<GroupBucketSection {...red} view="list" />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(red.entries.length);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it.each(['grid', 'list'] as const)('renders actions for each entry in %s view', (view) => {
    render(<GroupBucketSection {...red} view={view} renderActions={(e) => <button type="button">Remove {e.id}</button>} />);
    for (const e of red.entries) expect(screen.getByRole('button', { name: `Remove ${e.id}` })).toBeInTheDocument();
  });

  it('collapses and expands, rendering entries only while open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(<GroupBucketSection {...red} onOpenChange={onOpenChange} />);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'true');
    expect(container.firstElementChild).toHaveClass('group-bucket--open');
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(toggle('Red'));
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(container.firstElementChild).not.toHaveClass('group-bucket--open');

    await user.click(toggle('Red'));
    expect(screen.getAllByRole('article')).toHaveLength(red.entries.length);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('can start collapsed, rendering nothing below the header', () => {
    render(<GroupBucketSection {...red} view="list" defaultOpen={false} onLoadMore={() => {}} />);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows an empty group as empty, not as loading', () => {
    render(<GroupBucketSection group={makeGroup('E', 'Empty', []).group} entries={[]} />);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('follows a controlled open state and only reports clicks', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<GroupBucketSection {...red} open={false} onOpenChange={onOpenChange} />);
    await user.click(toggle('Red'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false'); // parent hasn't opened it yet
    rerender(<GroupBucketSection {...red} open onOpenChange={onOpenChange} />);
    expect(screen.getAllByRole('article')).toHaveLength(red.entries.length);
  });

  it('stays where it was when the parent stops controlling it', () => {
    const { rerender } = render(<GroupBucketSection {...red} open={false} />);
    rerender(<GroupBucketSection {...red} />);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a loading state, and no "Show more", while the first page is on its way', () => {
    render(<GroupBucketSection group={red.group} onLoadMore={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('asks for the first page when it starts open, once, even if the callback changes', () => {
    const onLoad = vi.fn();
    const { rerender } = render(<GroupBucketSection group={red.group} onLoad={onLoad} />);
    rerender(<GroupBucketSection group={red.group} onLoad={() => onLoad()} />);
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('asks for the first page when opened, not while collapsed or once loaded', async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    const { rerender } = render(<GroupBucketSection group={red.group} defaultOpen={false} onLoad={onLoad} />);
    expect(onLoad).not.toHaveBeenCalled();
    await user.click(toggle('Red'));
    expect(onLoad).toHaveBeenCalledOnce();

    rerender(<GroupBucketSection {...red} onLoad={onLoad} />);
    await user.click(toggle('Red'));
    await user.click(toggle('Red'));
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('offers a retry when the first page failed to load', async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    render(<GroupBucketSection group={red.group} onLoad={onLoad} loadFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load these cards.");
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onLoad).toHaveBeenCalledTimes(2); // once on mount, once for the retry
  });

  it('offers to load more only when there is more, and not twice at once', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const { rerender } = render(<GroupBucketSection {...red} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    rerender(<GroupBucketSection {...red} onLoadMore={onLoadMore} />);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(<GroupBucketSection {...red} onLoadMore={onLoadMore} loadingMore />);
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });
});
