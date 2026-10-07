import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { colorGroups, makeGroup, setGroup } from '../fixtures';
import { eur, getByTooltip } from '../test/helpers';
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

  it("shows the set's symbol in a set group's header, named by the set once", () => {
    const { container } = render(<GroupBucketSection {...setGroup} />);
    const set = setGroup.group.set!;
    expect(toggle(set.name)).toBeInTheDocument();
    expect(getByTooltip(toggle(set.name), set.name)).toHaveTextContent(set.code.toUpperCase());
    expect(container.querySelector('.group-bucket__toggle img')).toHaveAttribute('src', set.icon_svg_uri);
  });

  it("shows no set symbol in a group that isn't a set", () => {
    const { container } = render(<GroupBucketSection {...red} />);
    expect(container.querySelector('.group-bucket__toggle .set-symbol')).toBeNull();
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
    expect(getByTooltip(toggle('Green'), 'No price available')).toBeInTheDocument();
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
    const onOpenChange = vi.fn<(open: boolean) => void>();
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
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { rerender } = render(<GroupBucketSection {...red} open={false} onOpenChange={onOpenChange} />);
    await user.click(toggle('Red'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false'); // parent hasn't opened it yet
    rerender(<GroupBucketSection {...red} open onOpenChange={onOpenChange} />);
    expect(screen.getAllByRole('article')).toHaveLength(red.entries.length);
  });

  it('stays where it was when the parent stops controlling it', () => {
    const { rerender } = render(<GroupBucketSection {...red} open />);
    rerender(<GroupBucketSection {...red} open={false} />);
    rerender(<GroupBucketSection {...red} />);
    expect(toggle('Red')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a loading state, and no "Show more", while the first page is on its way', () => {
    render(<GroupBucketSection group={red.group} onLoadMore={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    // One live region per group would flood screen readers when many groups load at once.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('asks for the first page when it starts open, once, even if the callback changes', () => {
    const onLoad = vi.fn<() => void>();
    const { rerender } = render(<GroupBucketSection group={red.group} onLoad={onLoad} />);
    rerender(<GroupBucketSection group={red.group} onLoad={() => onLoad()} />);
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('asks for the first page when opened, not while collapsed or once loaded', async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn<() => void>();
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
    const onLoad = vi.fn<() => void>();
    render(<GroupBucketSection group={red.group} onLoad={onLoad} loadFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load these cards.");
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onLoad).toHaveBeenCalledTimes(2); // once on mount, once for the retry
  });

  it('says so when an open group has no cards', () => {
    render(<GroupBucketSection group={makeGroup('E', 'Empty', []).group} entries={[]} />);
    expect(screen.getByText('No cards in this group')).toBeInTheDocument();
  });

  it('offers to load more only when there is more, and not twice at once', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn<() => void>();
    const { rerender } = render(<GroupBucketSection {...red} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    rerender(<GroupBucketSection {...red} onLoadMore={onLoadMore} />);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    rerender(<GroupBucketSection {...red} onLoadMore={onLoadMore} loadingMore />);
    const busy = screen.getByRole('button', { name: 'Loading…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
