import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { colorGroups, customGroups, entries, makeEntry, makeGroup, cards, stats } from '../fixtures';
import { renderApp, signedIn, type FakeRequest, type Routes } from '../test/app';
import type { CollectionEntry, GroupSummary } from '../types';

const all = Object.values(entries);
const allGroup = makeGroup('all', 'All cards', all);
const byKey: Record<string, CollectionEntry[]> = Object.fromEntries([allGroup, ...colorGroups].map(({ group, entries: e }) => [group.key, e]));
const headers: Record<string, GroupSummary[]> = { none: [allGroup.group], color: colorGroups.map((g) => g.group) };

const collection: Routes = {
  ...signedIn,
  'GET /api/collection/stats': { body: stats },
  'GET /api/collection/groups': (req) => ({ body: { group_by: req.query.get('group_by'), groups: headers[req.query.get('group_by')!] ?? [] } }),
  'GET /api/collection/entries': (req) => ({ body: { entries: byKey[req.query.get('key')!] ?? [], next_cursor: null } }),
};

const main = () => within(screen.getByRole('main'));
const section = (label: RegExp) => screen.getByRole('button', { name: label }).closest('.group-bucket') as HTMLElement;
const keysAsked = (requests: FakeRequest[]) => requests.map((r) => r.query.get('key'));

describe('CollectionPage', () => {
  it('shows the totals and every card, grouped as nothing by default', async () => {
    const { api } = renderApp('/collection', collection);
    expect(await main().findByRole('region', { name: 'Collection summary' })).toHaveTextContent(String(stats.card_count));
    for (const e of all) expect(await main().findByRole('heading', { name: e.card.name })).toBeInTheDocument();
    expect(api.sent('GET /api/collection/groups')[0].query.get('group_by')).toBe('none');
    expect(api.sent('GET /api/collection/entries')[0].query.toString()).toBe('group_by=none&key=all&sort=name');
    expect(api.unhandled).toEqual([]);
  });

  it('groups, sorts and shows the cards as chosen, keeping the choice in the URL', async () => {
    const { api, user, location } = renderApp('/collection', collection);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    await user.selectOptions(main().getByRole('combobox', { name: 'Group by' }), 'Color');
    expect(await screen.findByRole('button', { name: /^Blue/ })).toBeInTheDocument();
    expect(location().search).toBe('?group_by=color');
    // Few groups: they all open, each fetching its own cards.
    await waitFor(() => expect(keysAsked(api.sent('GET /api/collection/entries'))).toEqual(expect.arrayContaining(['U', 'R', 'G', 'M'])));

    await user.selectOptions(main().getByRole('combobox', { name: 'Sort by' }), 'Price (highest first)');
    await waitFor(() => expect(api.sent('GET /api/collection/entries').some((r) => r.query.get('sort') === 'price')).toBe(true));
    expect(location().search).toBe('?group_by=color&sort=price');

    await user.click(main().getByRole('radio', { name: 'List' }));
    expect(location().search).toBe('?group_by=color&sort=price&view=list');
    expect(await within(section(/^Red/)).findByRole('table')).toBeInTheDocument();
  });

  it('opens only the first of many groups, and fetches others as they open', async () => {
    const many = Array.from({ length: 12 }, (_, i) => makeGroup(`s${i}`, `Set ${i}`, [makeEntry(100 + i, cards.lightningBolt)]));
    const { api, user } = renderApp('/collection?group_by=set', {
      ...collection,
      'GET /api/collection/groups': { body: { group_by: 'set', groups: many.map((g) => g.group) } },
      'GET /api/collection/entries': (req) => ({ body: { entries: many.find((g) => g.group.key === req.query.get('key'))!.entries, next_cursor: null } }),
    });
    await screen.findByRole('button', { name: /^Set 11/ });
    await waitFor(() => expect(keysAsked(api.sent('GET /api/collection/entries'))).toEqual(['s0']));
    expect(screen.getByRole('button', { name: /^Set 0/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Set 5/ })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: /^Set 5/ }));
    await waitFor(() => expect(keysAsked(api.sent('GET /api/collection/entries'))).toEqual(['s0', 's5']));
  });

  it("pages through a group's cards, showing each once though one moved between pages", async () => {
    const first = all.slice(0, 3);
    const second = [all[2], ...all.slice(3)];
    const { api, user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': (req) =>
        req.query.get('cursor') === 'page-2' ? { body: { entries: second, next_cursor: null } } : { body: { entries: first, next_cursor: 'page-2' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await main().findByRole('heading', { name: entries.unpricedElves.card.name });
    expect(main().getAllByRole('heading', { name: all[2].card.name })).toHaveLength(1);
    expect(api.sent('GET /api/collection/entries').map((r) => r.query.get('cursor'))).toEqual([null, 'page-2']);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it("says when a group's cards couldn't be loaded, and tries again", async () => {
    let fail = true;
    const { user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: { entries: all, next_cursor: null } }),
    });
    expect(await screen.findByText("Couldn't load these cards.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await main().findByRole('heading', { name: entries.bolts.card.name })).toBeInTheDocument();
  });

  it('says when the collection is empty, and where to add cards', async () => {
    renderApp('/collection', { ...collection, 'GET /api/collection/groups': { body: { group_by: 'none', groups: [{ ...allGroup.group, card_count: 0, entry_count: 0, value_eur: 0, unpriced_count: 0 }] } } });
    expect(await screen.findByText('Your collection is empty')).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Search for cards to add' })).toHaveAttribute('href', '/search');
  });

  describe('a group with a card it cannot show', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows an error for that group only', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const broken = { ...entries.bolts, card: { ...entries.bolts.card, set: undefined } } as unknown as CollectionEntry;
      renderApp('/collection?group_by=color', {
        ...collection,
        'GET /api/collection/entries': (req) => ({ body: { entries: req.query.get('key') === 'R' ? [broken] : byKey[req.query.get('key')!], next_cursor: null } }),
      });
      expect(await screen.findByText("Couldn't show Red.")).toBeInTheDocument();
      expect(await main().findByRole('heading', { name: entries.germanDelver.card.name })).toBeInTheDocument();
    });
  });
});

describe('entry actions', () => {
  const bolts = entries.bolts;
  const openAction = async (user: ReturnType<typeof renderApp>['user'], action: string) => {
    await user.click(await screen.findByRole('button', { name: `Actions for ${bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: action }));
    return screen.getByRole(action === 'Remove…' ? 'alertdialog' : 'dialog');
  };
  const oneEntry: Routes = { ...collection, 'GET /api/collection/entries': { body: { entries: [bolts], next_cursor: null } } };

  it('changes an entry, sending only what changed, then shows it changed', async () => {
    let shown = bolts;
    const { api, user } = renderApp('/collection', {
      ...oneEntry,
      'GET /api/collection/entries': () => ({ body: { entries: [shown], next_cursor: null } }),
      'PATCH /api/collection/entries/:id': (req) => {
        shown = { ...bolts, ...req.body };
        return { body: shown };
      },
    });
    const dialog = await openAction(user, 'Change…');
    const quantity = within(dialog).getByRole('spinbutton', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, '6');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Condition' }), 'LP: Light Played');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(`Saved 6 × ${bolts.card.name} (Non-foil, Light Played, English)`)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.sent('PATCH /api/collection/entries/:id').map((r) => [r.params.id, r.body])).toEqual([[String(bolts.id), { quantity: 6, condition: 'LP' }]]);
    // The collection is fetched again, so it shows the change.
    expect(await within(section(/^All cards/)).findByText('6×')).toBeInTheDocument();
  });

  it('closes without sending anything when nothing changed', async () => {
    const { api, user } = renderApp('/collection', oneEntry);
    const dialog = await openAction(user, 'Change…');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.sent('PATCH /api/collection/entries/:id')).toHaveLength(0);
  });

  it('puts focus back on the Actions button when a dialog closes', async () => {
    const { user } = renderApp('/collection', oneEntry);
    await openAction(user, 'Change…');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: `Actions for ${bolts.card.name}` })).toHaveFocus());
  });

  it('says why a change was refused, and stays open', async () => {
    const { user } = renderApp('/collection', {
      ...oneEntry,
      'PATCH /api/collection/entries/:id': { status: 409, body: { error: 'you already have that card in that finish, condition and language' } },
    });
    const dialog = await openAction(user, 'Change…');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Finish' }), 'Foil');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You already have that card in that finish, condition and language.');
  });

  it('removes an entry once confirmed', async () => {
    const { api, user } = renderApp('/collection', { ...oneEntry, 'DELETE /api/collection/entries/:id': { status: 204 } });
    const dialog = await openAction(user, 'Remove…');
    expect(dialog).toHaveTextContent(`4 × ${bolts.card.name} (Non-foil, Near Mint, English) will leave your collection`);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(`Removed 4 × ${bolts.card.name} (Non-foil, Near Mint, English)`)).toBeInTheDocument();
    expect(api.sent('DELETE /api/collection/entries/:id').map((r) => r.params.id)).toEqual([String(bolts.id)]);
  });

  it("doesn't remove an entry when cancelled", async () => {
    const { api, user } = renderApp('/collection', oneEntry);
    const dialog = await openAction(user, 'Remove…');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.sent('DELETE /api/collection/entries/:id')).toHaveLength(0);
  });

  it('puts copies in a group, saying how many it holds already', async () => {
    const [binder, deck] = customGroups;
    const { api, user } = renderApp('/collection', {
      ...oneEntry,
      'GET /api/groups': { body: { groups: customGroups } },
      'GET /api/groups/:id/members/:entry': (req) =>
        req.params.id === String(deck.id) ? { body: { entry: bolts, quantity: 3, value_eur: null, added_at: '2026-10-01T00:00:00Z' } } : { status: 404, body: { error: "that entry isn't in this group" } },
      'PUT /api/groups/:id/members/:entry': (req) => ({ status: 201, body: { entry: bolts, quantity: req.body.quantity, value_eur: null, added_at: '2026-10-01T00:00:00Z' } }),
    });
    const dialog = await openAction(user, 'Put in a group…');
    const copies = await within(dialog).findByRole('spinbutton', { name: 'Copies in the group' });
    await waitFor(() => expect(copies).toHaveAccessibleDescription('Up to 4 copies, all you have. It has none now.'));
    expect(copies).toHaveValue(1);
    // No more than the entry has: the browser refuses more, and says so.
    expect(copies).toHaveAttribute('max', '4');

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Group' }), deck.name);
    await waitFor(() => expect(copies).toHaveValue(3));
    expect(copies).toHaveAccessibleDescription('Up to 4 copies, all you have. It has 3 now.');

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Group' }), binder.name);
    await user.clear(copies);
    await user.type(copies, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Add to group' }));
    expect(await screen.findByText(`${binder.name} now holds 2 × ${bolts.card.name}`)).toBeInTheDocument();
    expect(api.sent('PUT /api/groups/:id/members/:entry').map((r) => [r.params.id, r.params.entry, r.body])).toEqual([
      [String(binder.id), String(bolts.id), { quantity: 2 }],
    ]);
  });

  it('offers to make a group when there are none', async () => {
    const { user } = renderApp('/collection', { ...oneEntry, 'GET /api/groups': { body: { groups: [] } } });
    const dialog = await openAction(user, 'Put in a group…');
    expect(await within(dialog).findByText('You have no groups yet')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Make a group' })).toHaveAttribute('href', '/groups');
  });
});
