import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { colorGroups, customGroups, entries, makeEntry, makeGroup, cards, stats } from '../fixtures';
import { keys } from '../api/keys';
import { ann, renderApp, signedIn, type FakeRequest, type Reply, type Routes } from '../test/app';
import { cardPath } from '../lib/paths';
import { countOf } from '../lib/format';
import type { CardSummary, CollectionEntry, GroupSummary } from '../types';

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

describe('CollectionPage, the larger card view', () => {
  it("opens from a card's image, links to the card's page, and gives focus back on closing", async () => {
    const bolt = entries.bolts.card;
    const { api, user } = renderApp('/collection', { ...collection, 'GET /api/cards/:id': { body: bolt } });
    const view = await main().findByRole('button', { name: `View ${bolt.name} larger` });
    await user.click(view);
    const dialog = await screen.findByRole('dialog', { name: bolt.name });
    expect(within(dialog).getByRole('img', { name: bolt.name })).toHaveAttribute('src', bolt.images!.large);
    expect(within(dialog).getByRole('link', { name: 'Card details' })).toHaveAttribute('href', cardPath(bolt.id));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // React Aria gives focus back a frame after the dialog goes.
    await waitFor(() => expect(view).toHaveFocus());

    // And after its close button.
    await user.click(view);
    await user.click(within(await screen.findByRole('dialog', { name: bolt.name })).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // React Aria gives focus back a frame after the dialog goes.
    await waitFor(() => expect(view).toHaveFocus());
    expect(api.unhandled).toEqual([]);
  });

  it("still shows the card if the whole card can't be fetched, just without turning over", async () => {
    const { faces: _faces, ...delverSummary } = cards.delver;
    const delver: CardSummary = delverSummary;
    const { user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': { body: { entries: [makeEntry(3, delver)], next_cursor: null } },
      'GET /api/cards/:id': { status: 500, body: { error: 'the database is unavailable' } },
    });
    await user.click(await main().findByRole('button', { name: `View ${delver.name} larger` }));
    const dialog = await screen.findByRole('dialog', { name: delver.name });
    await waitFor(() => expect(within(dialog).getByRole('img', { name: delver.name })).toHaveAttribute('src', delver.images!.large));
    expect(within(dialog).queryByRole('button', { name: 'Turn over' })).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('unavailable');
  });

  it('stays open while the listing behind it reloads or empties, rather than going and coming back', async () => {
    const bolt = entries.bolts.card;
    let gone = false;
    const { client, user } = renderApp('/collection', {
      ...collection,
      'GET /api/cards/:id': { body: bolt },
      'GET /api/collection/groups': (req) => ({ body: { group_by: req.query.get('group_by'), groups: gone ? [] : headers[req.query.get('group_by')!] } }),
    });
    await user.click(await main().findByRole('button', { name: `View ${bolt.name} larger` }));
    expect(await screen.findByRole('dialog', { name: bolt.name })).toBeInTheDocument();
    // Another tab removes the cards: the listing behind shows the empty collection.
    gone = true;
    await act(() => client.invalidateQueries({ queryKey: ['collection'] }));
    // (Hidden from screen readers while the dialog is open, so found by its text.)
    expect(await screen.findByText('Your collection is empty')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: bolt.name })).toBeInTheDocument();
  });

  it('closes when someone else signs in (in another tab), not left over their collection', async () => {
    const bolt = entries.bolts.card;
    const { client, user } = renderApp('/collection', { ...collection, 'GET /api/cards/:id': { body: bolt } });
    await user.click(await main().findByRole('button', { name: `View ${bolt.name} larger` }));
    expect(await screen.findByRole('dialog', { name: bolt.name })).toBeInTheDocument();
    act(() => client.setQueryData(keys.me, { id: ann.id + 1, email: 'bob@example.com' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main().findByRole('button', { name: `View ${bolt.name} larger` })).toBeInTheDocument();
  });

  it('turns a double-faced card over once the whole card has come, fetched only on opening', async () => {
    // What a listing really carries: no faces, only the front image.
    const { faces: _faces, ...delverSummary } = cards.delver;
    const delver: CardSummary = delverSummary;
    const { api, user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': { body: { entries: [makeEntry(3, delver, { quantity: 2 })], next_cursor: null } },
      'GET /api/cards/:id': (req) => ({ body: req.params.id === cards.delver.id ? cards.delver : undefined, status: req.params.id === cards.delver.id ? 200 : 404 }),
    });
    const view = await main().findByRole('button', { name: `View ${delver.name} larger` });
    expect(api.sent('GET /api/cards/:id')).toHaveLength(0);
    await user.click(view);
    const dialog = await screen.findByRole('dialog', { name: delver.name });
    await user.click(await within(dialog).findByRole('button', { name: 'Turn over' }));
    expect(within(dialog).getByRole('img')).toHaveAccessibleName(cards.delver.faces![1].name);
    expect(api.sent('GET /api/cards/:id')).toHaveLength(1);
  });
});

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

  it('stays where it is scrolled to when the grouping or view changes', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    const { user } = renderApp('/collection', collection);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    scrollTo.mockClear();
    await user.selectOptions(main().getByRole('combobox', { name: 'Group by' }), 'Color');
    await screen.findByRole('button', { name: /^Blue/ });
    await user.click(main().getByRole('radio', { name: 'List' }));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
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

describe('refreshing after a change', () => {
  it('Show more waits for a refresh under way rather than cancelling it, and follows the fresh pages', async () => {
    let quantity = 4;
    let slow = false;
    const { api, user, client } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': async (req) => {
        if (req.query.get('cursor') === 'p2') return { body: { entries: [entries.foilRagavan], next_cursor: null } };
        if (slow) await new Promise((resolve) => setTimeout(resolve, 150));
        return { body: { entries: [{ ...entries.bolts, quantity }], next_cursor: 'p2' } };
      },
    });
    await screen.findByRole('button', { name: 'Show more' });
    quantity = 9;
    slow = true;
    act(() => void client.invalidateQueries({ queryKey: ['collection'] }));
    // Busy while the refresh runs: pressing it does nothing.
    await user.click(await screen.findByRole('button', { name: 'Loading…' }));
    expect(await screen.findByText('9×')).toBeInTheDocument();
    expect(api.sent('GET /api/collection/entries').map((r) => r.query.get('cursor'))).toEqual([null, null]);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await main().findByRole('heading', { name: entries.foilRagavan.card.name })).toBeInTheDocument();
  });

  it('keeps showing the cards when a refresh fails', async () => {
    let fail = false;
    const { client } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: { entries: all, next_cursor: null } }),
      'GET /api/collection/groups': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: { group_by: 'none', groups: [allGroup.group] } }),
    });
    await main().findByRole('heading', { name: entries.bolts.card.name });
    fail = true;
    await act(() => client.invalidateQueries({ queryKey: ['collection'] }));
    // The failures reach the page on a later tick.
    await waitFor(() => expect(client.getQueryState(keys.listingGroups(null, 'none', ''))?.status).toBe('error'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(main().getByRole('heading', { name: entries.bolts.card.name })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load these cards.")).not.toBeInTheDocument();
  });

  it('keeps the cards loaded when Show more fails, and says so', async () => {
    const { user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': (req) =>
        req.query.get('cursor') === 'p2' ? { status: 503, body: { error: 'that took too long; try again' } } : { body: { entries: [entries.bolts], next_cursor: 'p2' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText("Couldn't load more of All cards")).toBeInTheDocument();
    expect(main().getByRole('heading', { name: entries.bolts.card.name })).toBeInTheDocument();
  });

  it('replaces the history entry when the grouping changes, rather than adding one each time', async () => {
    const { user, router } = renderApp('/collection', collection);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    await user.selectOptions(main().getByRole('combobox', { name: 'Group by' }), 'Color');
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('how many groups start open', () => {
  const groupsOf = (n: number) => Array.from({ length: n }, (_, i) => makeGroup(`s${i}`, `Set ${i}`, [makeEntry(200 + i, cards.lightningBolt)]));
  const render = (many: ReturnType<typeof groupsOf>) =>
    renderApp('/collection?group_by=set', {
      ...collection,
      'GET /api/collection/groups': { body: { group_by: 'set', groups: many.map((g) => g.group) } },
      'GET /api/collection/entries': (req) => ({ body: { entries: many.find((g) => g.group.key === req.query.get('key'))!.entries, next_cursor: null } }),
    });

  it('opens all of eight', async () => {
    render(groupsOf(8));
    await screen.findByRole('button', { name: /^Set 7/ });
    expect(screen.getByRole('button', { name: /^Set 7/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens only the first of nine', async () => {
    render(groupsOf(9));
    await screen.findByRole('button', { name: /^Set 8/ });
    expect(screen.getByRole('button', { name: /^Set 0/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Set 1/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('a section that failed to show its cards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches them afresh to try again, rather than showing the same again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const bad = { ...entries.bolts, card: { ...entries.bolts.card, set: undefined } } as unknown as CollectionEntry;
    const { user } = renderApp('/collection?group_by=color', {
      ...collection,
      'GET /api/collection/entries': (req) => ({
        body: { entries: req.query.get('key') === 'R' ? (broken ? [bad] : [entries.bolts]) : byKey[req.query.get('key')!], next_cursor: null },
      }),
    });
    const error = (await screen.findByText("Couldn't show Red.")).closest('[role="alert"]') as HTMLElement;
    broken = false;
    await user.click(within(error).getByRole('button', { name: 'Try again' }));
    expect(await main().findByRole('heading', { name: entries.bolts.card.name })).toBeInTheDocument();
  });
});

describe('focus after a card goes', () => {
  it('moves to the section heading when the card that had it is removed', async () => {
    let shown = [entries.bolts, entries.foilRagavan];
    const { user } = renderApp('/collection', {
      ...collection,
      'GET /api/collection/entries': () => ({ body: { entries: shown, next_cursor: null } }),
      'DELETE /api/collection/entries/:id': (req) => {
        shown = shown.filter((e) => String(e.id) !== req.params.id);
        return { status: 204 };
      },
    });
    await user.click(await screen.findByRole('button', { name: `Actions for ${entries.bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(main().queryByRole('heading', { name: entries.bolts.card.name })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^All cards/ })).toHaveFocus());
  });
});

describe('putting copies in a group', () => {
  const [binder, deck] = customGroups;
  const member = (quantity: number) => ({ entry: entries.bolts, quantity, value_eur: null, added_at: '2026-10-01T00:00:00Z' });
  const oneEntry: Routes = { ...collection, 'GET /api/collection/entries': { body: { entries: [entries.bolts], next_cursor: null } } };
  const open = async (user: ReturnType<typeof renderApp>['user']) => {
    await user.click(await screen.findByRole('button', { name: `Actions for ${entries.bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Put in a group…' }));
    return screen.getByRole('dialog');
  };

  it("waits to know what the group holds, so as not to overwrite it, and says when it can't find out", async () => {
    let fail = true;
    const { user } = renderApp('/collection', {
      ...oneEntry,
      'GET /api/groups': { body: { groups: customGroups } },
      'GET /api/groups/:id/members/:entry': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: member(3) }),
    });
    const dialog = await open(user);
    expect(await within(dialog).findByText(/Couldn't find out how many the group holds now/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add to group' })).toBeDisabled();
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(dialog).getByRole('spinbutton', { name: 'Copies in the group' })).toHaveValue(3);
  });

  it('falls back to the first group when the chosen one is deleted meanwhile', async () => {
    let groups = customGroups;
    const { api, user, client } = renderApp('/collection', {
      ...oneEntry,
      'GET /api/groups': () => ({ body: { groups } }),
      'GET /api/groups/:id/members/:entry': { status: 404, body: { error: "that entry isn't in this group" } },
      'PUT /api/groups/:id/members/:entry': { status: 201, body: member(1) },
    });
    const dialog = await open(user);
    const select = await within(dialog).findByRole('combobox', { name: 'Group' });
    await user.selectOptions(select, deck.name);
    expect(select).toHaveValue(String(deck.id));
    groups = customGroups.filter((g) => g.id !== deck.id);
    await act(() => client.invalidateQueries({ queryKey: keys.groupList }));
    await waitFor(() => expect(select).toHaveValue(String(binder.id)));
    // And that's where the copies go (not to the deleted group the select can no longer show).
    await within(dialog).findByText(/It has none now/);
    await user.click(within(dialog).getByRole('button', { name: 'Add to group' }));
    await waitFor(() => expect(api.sent('PUT /api/groups/:id/members/:entry').map((r) => r.params.id)).toEqual([String(binder.id)]));
  });

  it('takes the new membership from the answer, rather than asking for it again', async () => {
    const { api, user } = renderApp('/collection', {
      ...oneEntry,
      'GET /api/groups': { body: { groups: customGroups } },
      'GET /api/groups/:id/members/:entry': { status: 404, body: { error: "that entry isn't in this group" } },
      'PUT /api/groups/:id/members/:entry': { status: 201, body: member(1) },
    });
    const dialog = await open(user);
    await within(dialog).findByText(/It has none now/);
    await user.click(within(dialog).getByRole('button', { name: 'Add to group' }));
    await screen.findByText(`${binder.name} now holds 1 × ${entries.bolts.card.name}`);
    const afterPut = api.requests.slice(api.requests.findIndex((r) => r.method === 'PUT') + 1);
    expect(afterPut.filter((r) => r.path.includes('/members/'))).toEqual([]);
  });
});

describe('searching the collection', () => {
  // As the server matches: every word in the card's name or type line, ignoring case.
  const matches = (e: CollectionEntry, q: string | null) =>
    (q ?? '').toLowerCase().split(' ').filter(Boolean).every((word) => `${e.card.name} ${e.card.type_line}`.toLowerCase().includes(word));
  const searchedGroups = (by: string, q: string | null) =>
    (by === 'none' ? [allGroup] : colorGroups)
      .map((g) => makeGroup(g.group.key, g.group.label, g.entries.filter((e) => matches(e, q))))
      .filter((g) => by === 'none' || g.entries.length > 0)
      .map((g) => g.group);
  const searchable: Routes = {
    ...collection,
    'GET /api/collection/groups': (req) => ({ body: { group_by: req.query.get('group_by'), groups: searchedGroups(req.query.get('group_by')!, req.query.get('q')) } }),
    'GET /api/collection/entries': (req) => ({ body: { entries: (byKey[req.query.get('key')!] ?? []).filter((e) => matches(e, req.query.get('q'))), next_cursor: null } }),
  };
  const creatures = all.filter((e) => matches(e, 'creature'));
  const box = () => main().getByRole('searchbox', { name: 'Search' });
  const status = () => screen.getByText((_, el) => el?.classList.contains('listing__status') ?? false);

  it('narrows the listing to the cards that match, keeping the search in the URL', async () => {
    const { api, user, location } = renderApp('/collection', searchable);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    await user.type(box(), 'creature');
    await waitFor(() => expect(main().queryByRole('heading', { name: entries.bolts.card.name })).not.toBeInTheDocument());
    for (const e of creatures) expect(await main().findByRole('heading', { name: e.card.name })).toBeInTheDocument();
    expect(location().search).toBe('?q=creature');
    expect(api.sent('GET /api/collection/groups').at(-1)!.query.get('q')).toBe('creature');
    expect(api.sent('GET /api/collection/entries').at(-1)!.query.get('q')).toBe('creature');
    expect(api.unhandled).toEqual([]);
  });

  it('says when no cards match, rather than that the collection is empty', async () => {
    const { user } = renderApp('/collection', searchable);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    await user.type(box(), 'zzz');
    expect(await main().findByText('No cards match “zzz”')).toBeInTheDocument();
    expect(main().getByText('Check the spelling, or clear the search.')).toBeInTheDocument();
    expect(main().queryByText('Your collection is empty')).not.toBeInTheDocument();
  });

  it('says the collection is empty, not that nothing matches, when there are no cards at all', async () => {
    renderApp('/collection?q=goblin', {
      ...collection,
      'GET /api/collection/stats': { body: { ...stats, card_count: 0, unique_cards: 0, value_eur: 0, unpriced_count: 0, by_color: {}, by_rarity: {} } },
      'GET /api/collection/groups': { body: { group_by: 'none', groups: [{ ...allGroup.group, card_count: 0, entry_count: 0, value_eur: 0, unpriced_count: 0 }] } },
    });
    expect(await main().findByText('Your collection is empty')).toBeInTheDocument();
    expect(main().queryByText('Check the spelling, or clear the search.')).not.toBeInTheDocument();
  });

  it("brings the results' start into view when a search from far down the page finds them", async () => {
    const { user } = renderApp('/collection', searchable);
    await main().findByRole('heading', { name: entries.bolts.card.name });
    // Scrolled far down: the results' start is above the sticky toolbar's bottom (120px).
    const start = status();
    let startTop = -800;
    const rect = (top: number) => ({ top, bottom: top, height: 0, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(start, 'getBoundingClientRect').mockImplementation(() => rect(startTop));
    vi.spyOn(document.querySelector('.listing-controls')!, 'getBoundingClientRect').mockImplementation(() => ({ ...rect(0), bottom: 120, height: 120 }) as DOMRect);
    const scrolled = vi.fn<(this: Element) => void>(function () {
      if (this === start) startTop = 200;
    });
    Element.prototype.scrollIntoView = scrolled;
    onTestFinished(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
      vi.restoreAllMocks();
    });

    await user.type(box(), 'creature');
    await main().findByRole('heading', { name: creatures[0].card.name });
    await waitFor(() => expect(scrolled.mock.contexts).toEqual([start]));
    // Already in view: the next search leaves the page where it is.
    await user.type(box(), ' elf');
    await waitFor(() => expect(status()).toHaveTextContent(/match/));
    await waitFor(() => expect(main().queryByRole('heading', { name: entries.foilRagavan.card.name })).not.toBeInTheDocument());
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('announces how many cards match', async () => {
    const { user } = renderApp('/collection?q=creature', searchable);
    const copies = creatures.reduce((n, e) => n + e.quantity, 0);
    await waitFor(() => expect(status().textContent).toBe(`${countOf(copies, 'card')} match`));
    expect(status()).toHaveAttribute('role', 'status');
    await user.clear(box());
    await user.type(box(), 'zzz');
    await waitFor(() => expect(status().textContent).toBe('No cards match'));
    // Not searching: once every card is back, nothing to announce.
    await user.click(main().getByRole('button', { name: 'Clear search' }));
    for (const e of all) await main().findByRole('heading', { name: e.card.name });
    expect(status().textContent).toBe('');
  });

  it('sends the search with the cursor for more', async () => {
    const { api, user } = renderApp('/collection?q=creature', {
      ...searchable,
      'GET /api/collection/entries': (req) =>
        req.query.get('cursor') === 'page-2' ? { body: { entries: creatures.slice(1), next_cursor: null } } : { body: { entries: creatures.slice(0, 1), next_cursor: 'page-2' } },
    });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await main().findByRole('heading', { name: creatures.at(-1)!.card.name });
    expect(api.sent('GET /api/collection/entries').map((r) => [r.query.get('q'), r.query.get('cursor')])).toEqual([
      ['creature', null],
      ['creature', 'page-2'],
    ]);
  });

  it('searches within the chosen grouping', async () => {
    const { api } = renderApp('/collection?group_by=color&q=creature', searchable);
    expect(await screen.findByRole('button', { name: /^Blue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Red/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Green/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Multicolor/ })).not.toBeInTheDocument();
    await waitFor(() => expect(keysAsked(api.sent('GET /api/collection/entries'))).toEqual(expect.arrayContaining(['U', 'R', 'G'])));
    expect(api.sent('GET /api/collection/entries').every((r) => r.query.get('q') === 'creature')).toBe(true);
  });

  it("keeps the last search's cards up while the next search's load", async () => {
    let release = () => {};
    const { api, user } = renderApp('/collection', {
      ...searchable,
      'GET /api/collection/groups': (req) =>
        req.query.get('q') === 'zzz'
          ? new Promise((resolve) => (release = () => resolve((searchable['GET /api/collection/groups'] as (r: FakeRequest) => Reply)(req))))
          : (searchable['GET /api/collection/groups'] as (r: FakeRequest) => Reply)(req),
    });
    const bolts = await main().findByRole('heading', { name: entries.bolts.card.name });
    await user.type(box(), 'zzz');
    await waitFor(() => expect(bolts.closest('.listing')).toHaveAttribute('aria-busy', 'true'));
    expect(bolts).toBeInTheDocument();
    // The sections are the last search's, so they ask nothing of the next search yet.
    expect(api.sent('GET /api/collection/entries').some((r) => r.query.get('q') === 'zzz')).toBe(false);
    act(() => release());
    expect(await main().findByText('No cards match “zzz”')).toBeInTheDocument();
  });

  it("keeps a section's heading and cards from the same search, without blinking, while its next cards load", async () => {
    let release = () => {};
    const { api, user } = renderApp('/collection', {
      ...searchable,
      'GET /api/collection/entries': (req) =>
        req.query.get('q') === 'creature'
          ? new Promise((resolve) => (release = () => resolve((searchable['GET /api/collection/entries'] as (r: FakeRequest) => Reply)(req))))
          : (searchable['GET /api/collection/entries'] as (r: FakeRequest) => Reply)(req),
    });
    const bolts = await main().findByRole('heading', { name: entries.bolts.card.name });
    const heading = screen.getByRole('button', { name: /^All cards/ });
    const everyCopy = all.reduce((n, e) => n + e.quantity, 0);
    await user.type(box(), 'creature');
    // The new search's groups are in, its cards not yet: the section stays as it was, busy.
    await waitFor(() => expect(api.sent('GET /api/collection/entries').some((r) => r.query.get('q') === 'creature')).toBe(true));
    expect(bolts).toBeInTheDocument();
    expect(heading).toHaveTextContent(countOf(everyCopy, 'card'));
    expect(main().queryByText('Loading…')).not.toBeInTheDocument();
    expect(bolts.closest('.listing__section')).toHaveAttribute('aria-busy', 'true');
    expect(main().queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();

    act(() => release());
    for (const e of creatures) expect(await main().findByRole('heading', { name: e.card.name })).toBeInTheDocument();
    expect(main().queryByRole('heading', { name: entries.bolts.card.name })).not.toBeInTheDocument();
    expect(heading).toHaveTextContent(countOf(creatures.reduce((n, e) => n + e.quantity, 0), 'card'));
    expect(heading.closest('.listing__section')).not.toHaveAttribute('aria-busy');
  });

  it("gives a closed section the next search's heading, and keeps its heading with its cards when reopened", async () => {
    // Ten sets, each with Lightning Bolt and Ragavan: "creature" leaves all ten (so only the
    // first is open by default), each with just its Ragavan.
    const sets = Array.from({ length: 10 }, (_, i) => makeGroup(`s${i}`, `Set ${i}`, [makeEntry(200 + 2 * i, cards.lightningBolt, { quantity: 3 }), makeEntry(201 + 2 * i, cards.ragavan)]));
    const narrowed = (q: string | null) => sets.map((g) => makeGroup(g.group.key, g.group.label, g.entries.filter((e) => matches(e, q))));
    const entriesOf = (req: FakeRequest): Reply => ({ body: { entries: narrowed(req.query.get('q')).find((g) => g.group.key === req.query.get('key'))!.entries, next_cursor: null } });
    let release = () => {};
    const { user } = renderApp('/collection?group_by=set', {
      ...collection,
      'GET /api/collection/groups': (req) => ({ body: { group_by: 'set', groups: narrowed(req.query.get('q')).map((g) => g.group) } }),
      'GET /api/collection/entries': (req) =>
        req.query.get('q') === 'creature' && req.query.get('key') === 's5' ? new Promise((resolve) => (release = () => resolve(entriesOf(req)))) : entriesOf(req),
    });
    const five = await screen.findByRole('button', { name: /^Set 5/ });
    const set5 = () => within(five.closest('.listing__section') as HTMLElement);
    const everyCopy = countOf(4, 'card');
    // Opened (its cards fetched), then closed again.
    await user.click(five);
    await set5().findByRole('heading', { name: cards.lightningBolt.name });
    await user.click(five);
    expect(five).toHaveTextContent(everyCopy);

    await user.type(box(), 'creature');
    await waitFor(() => expect(five).toHaveTextContent(countOf(1, 'card')));
    expect(five).toHaveAttribute('aria-expanded', 'false');

    // Reopened while its creatures load: the last search's cards, with the heading they came with.
    await user.click(five);
    expect(set5().getByRole('heading', { name: cards.lightningBolt.name })).toBeInTheDocument();
    expect(five).toHaveTextContent(everyCopy);
    act(() => release());
    await waitFor(() => expect(set5().queryByRole('heading', { name: cards.lightningBolt.name })).not.toBeInTheDocument());
    expect(set5().getByRole('heading', { name: cards.ragavan.name })).toBeInTheDocument();
    expect(five).toHaveTextContent(countOf(1, 'card'));
  });

  it('opens the sections a search leaves, as a fresh page would, when it narrows many groups to a few', async () => {
    // Twelve sets (only the first starts open); the search leaves sets 3 and 7.
    const many = Array.from({ length: 12 }, (_, i) => makeGroup(`s${i}`, `Set ${i}`, [makeEntry(100 + i, cards.lightningBolt)]));
    const found = (q: string | null) => (q ? many.filter((g) => g.group.key === 's3' || g.group.key === 's7') : many);
    const { api, user } = renderApp('/collection?group_by=set', {
      ...collection,
      'GET /api/collection/groups': (req) => ({ body: { group_by: 'set', groups: found(req.query.get('q')).map((g) => g.group) } }),
      'GET /api/collection/entries': (req) => ({ body: { entries: many.find((g) => g.group.key === req.query.get('key'))!.entries, next_cursor: null } }),
    });
    await screen.findByRole('button', { name: /^Set 11/ });
    expect(screen.getByRole('button', { name: /^Set 3/ })).toHaveAttribute('aria-expanded', 'false');
    // One the user opened stays open; the others follow what a fresh page would do.
    await user.click(screen.getByRole('button', { name: /^Set 7/ }));
    await user.type(box(), 'bolt');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Set 11/ })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Set 3/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Set 7/ })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(api.sent('GET /api/collection/entries').filter((r) => r.query.get('q') === 'bolt').map((r) => r.query.get('key'))).toEqual(expect.arrayContaining(['s3', 's7'])),
    );
  });

  it('brings every card back when the search is cleared', async () => {
    const { user, location } = renderApp('/collection?q=creature', searchable);
    await main().findByRole('heading', { name: creatures[0].card.name });
    await user.click(main().getByRole('button', { name: 'Clear search' }));
    for (const e of all) expect(await main().findByRole('heading', { name: e.card.name })).toBeInTheDocument();
    expect(location().search).toBe('');
    expect(box()).toHaveValue('');
  });

  it('refreshes the searched listing after a change, keeping the search', async () => {
    const { api, user } = renderApp('/collection?q=bolt', { ...searchable, 'DELETE /api/collection/entries/:id': { status: 204 } });
    await user.click(await screen.findByRole('button', { name: `Actions for ${entries.bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.sent('GET /api/collection/groups')).toHaveLength(2));
    expect(api.sent('GET /api/collection/groups').map((r) => r.query.get('q'))).toEqual(['bolt', 'bolt']);
  });

  it('starts the search afresh when the Collection link is followed', async () => {
    const { user, location } = renderApp('/collection?q=creature', searchable);
    await main().findByRole('heading', { name: creatures[0].card.name });
    expect(box()).toHaveValue('creature');
    await user.click(screen.getByRole('link', { name: 'Collection' }));
    await waitFor(() => expect(location().search).toBe(''));
    expect(box()).toHaveValue('');
    for (const e of all) expect(await main().findByRole('heading', { name: e.card.name })).toBeInTheDocument();
  });
});
