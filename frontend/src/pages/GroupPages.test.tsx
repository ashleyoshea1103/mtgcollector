import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { customGroups, entries, makeGroup } from '../fixtures';
import { keys } from '../api/keys';
import { renderApp, signedIn, type Routes } from '../test/app';
import { eur } from '../test/helpers';
import type { CustomGroup, GroupMember } from '../types';

const [binder] = customGroups;
const main = () => within(screen.getByRole('main'));

const member = (entry: typeof entries.bolts, quantity: number): GroupMember => ({
  entry,
  quantity,
  value_eur: entry.unit_price_eur === null ? null : Math.round(entry.unit_price_eur * quantity * 100) / 100,
  added_at: '2026-10-02T00:00:00Z',
});
// The binder holds 2 of the 4 bolts, and the elves.
const members = [member(entries.bolts, 2), member(entries.unpricedElves, 3)];
const binderAll = makeGroup('all', 'All cards', members.map((m) => ({ ...m.entry, quantity: m.quantity, value_eur: m.value_eur })));

const groupApi = (group: CustomGroup = binder): Routes => ({
  ...signedIn,
  'GET /api/groups': { body: { groups: customGroups } },
  'GET /api/groups/:id': (req) => (req.params.id === String(group.id) ? { body: group } : { status: 404, body: { error: 'no such group' } }),
  'GET /api/groups/:id/groups': { body: { group_by: 'none', groups: [binderAll.group] } },
  'GET /api/groups/:id/members': { body: { members, next_cursor: null } },
});

describe('GroupsPage', () => {
  it('lists the groups, each linking to its page', async () => {
    renderApp('/groups', groupApi());
    for (const g of customGroups) {
      expect(await main().findByRole('heading', { name: g.name })).toBeInTheDocument();
      expect(main().getByRole('link', { name: `Open ${g.name}` })).toHaveAttribute('href', `/groups/${g.id}`);
    }
  });

  it('says when there are no groups, offering to make one', async () => {
    renderApp('/groups', { ...groupApi(), 'GET /api/groups': { body: { groups: [] } } });
    expect(await main().findByText('No groups yet')).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'New group' })).toBeInTheDocument();
  });

  it('makes a group, checking it has a name, then opens it', async () => {
    const made: CustomGroup = { id: 9, name: 'Modern deck', kind: 'deck', description: 'Burn', preview_images: [], card_count: 0, value_eur: 0, unpriced_count: 0 };
    const { api, user, location } = renderApp('/groups', {
      ...groupApi(made),
      'POST /api/groups': { status: 201, body: made },
      'GET /api/groups/:id/groups': { body: { group_by: 'none', groups: [{ ...binderAll.group, card_count: 0, entry_count: 0, value_eur: 0, unpriced_count: 0 }] } },
    });
    await user.click(await main().findByRole('button', { name: 'New group' }));
    const dialog = screen.getByRole('dialog', { name: 'New group' });
    // Only spaces: the browser's required check passes it, ours doesn't.
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Make group' }));
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(expect.stringContaining('Give the group a name.'));
    expect(api.sent('POST /api/groups')).toHaveLength(0);

    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Modern deck');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Kind' }), 'Deck');
    await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Burn');
    await user.click(within(dialog).getByRole('button', { name: 'Make group' }));

    // The dialog closes as the new group's page opens (until then it hides the page from screen readers).
    expect(await screen.findByRole('heading', { level: 1, name: 'Modern deck' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(location().pathname).toBe('/groups/9');
    expect(api.sent('POST /api/groups').map((r) => r.body)).toEqual([{ name: 'Modern deck', kind: 'deck', description: 'Burn' }]);
    expect(screen.getByText('Made Modern deck')).toBeInTheDocument();
  });

  it('says why a group could not be made', async () => {
    const { user } = renderApp('/groups', { ...groupApi(), 'POST /api/groups': { status: 409, body: { error: 'you already have a group with that name' } } });
    await user.click(await main().findByRole('button', { name: 'New group' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), binder.name);
    await user.click(within(dialog).getByRole('button', { name: 'Make group' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You already have a group with that name.');
  });
});

describe('GroupPage', () => {
  it("shows the group, and its cards with the group's copies", async () => {
    const { api } = renderApp(`/groups/${binder.id}`, groupApi());
    expect(await main().findByRole('heading', { level: 1, name: binder.name })).toBeInTheDocument();
    expect(main().getByText(binder.description)).toBeInTheDocument();
    expect(main().getByText('Binder')).toBeInTheDocument();
    const bolts = (await main().findByRole('heading', { name: entries.bolts.card.name })).closest('article')!;
    expect(within(bolts).getByText('2×')).toBeInTheDocument();
    expect(api.sent('GET /api/groups/:id/members')[0].query.toString()).toBe('group_by=none&key=all&sort=name');
    expect(api.unhandled).toEqual([]);
  });

  it.each(['abc', '0', '1.5'])("says there's no such group at /groups/%s, without asking the server", async (id) => {
    const { api } = renderApp(`/groups/${id}`, groupApi());
    expect(await main().findByRole('heading', { level: 1, name: 'Group not found' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'See your groups' })).toHaveAttribute('href', '/groups');
    expect(api.sent('GET /api/groups/:id')).toHaveLength(0);
  });

  it("says there's no such group when the server has none", async () => {
    renderApp('/groups/404', groupApi());
    expect(await main().findByRole('heading', { level: 1, name: 'Group not found' })).toBeInTheDocument();
  });

  it('says when the group has no cards yet, and how to add some', async () => {
    renderApp(`/groups/${binder.id}`, { ...groupApi(), 'GET /api/groups/:id/groups': { body: { group_by: 'none', groups: [] } } });
    expect(await main().findByText(`No cards in ${binder.name} yet`)).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'your collection' })).toHaveAttribute('href', '/collection');
  });

  it('changes only what was changed', async () => {
    let shown = binder;
    const { api, user } = renderApp(`/groups/${binder.id}`, {
      ...groupApi(),
      'GET /api/groups/:id': () => ({ body: shown }),
      'PATCH /api/groups/:id': (req) => {
        shown = { ...binder, ...req.body };
        return { body: shown };
      },
    });
    await user.click(await main().findByRole('button', { name: 'Change…' }));
    const dialog = screen.getByRole('dialog', { name: `Change ${binder.name}` });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue(binder.name);
    await user.clear(name);
    await user.type(name, 'Trades');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await main().findByRole('heading', { level: 1, name: 'Trades' })).toBeInTheDocument();
    expect(api.sent('PATCH /api/groups/:id').map((r) => r.body)).toEqual([{ name: 'Trades' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends nothing when nothing was changed', async () => {
    const { api, user } = renderApp(`/groups/${binder.id}`, groupApi());
    await user.click(await main().findByRole('button', { name: 'Change…' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.sent('PATCH /api/groups/:id')).toHaveLength(0);
  });

  it('deletes the group once confirmed, back to the list, without fetching it again', async () => {
    const { api, user, location } = renderApp(`/groups/${binder.id}`, { ...groupApi(), 'DELETE /api/groups/:id': { status: 204 } });
    await user.click(await main().findByRole('button', { name: 'Delete…' }));
    const dialog = screen.getByRole('alertdialog', { name: `Delete ${binder.name}?` });
    expect(dialog).toHaveTextContent('its cards stay in your collection');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(location().pathname).toBe('/groups'));
    expect(screen.getByText(`Deleted ${binder.name}`)).toBeInTheDocument();
    expect(api.sent('DELETE /api/groups/:id').map((r) => r.params.id)).toEqual([String(binder.id)]);
    expect(api.sent('GET /api/groups/:id')).toHaveLength(1);
  });

  it("changes a card's copies in the group, up to all the entry has", async () => {
    const { api, user } = renderApp(`/groups/${binder.id}`, {
      ...groupApi(),
      'PUT /api/groups/:id/members/:entry': (req) => ({ body: member(entries.bolts, req.body.quantity) }),
    });
    await user.click(await main().findByRole('button', { name: `Actions for ${entries.bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Change copies…' }));
    const dialog = screen.getByRole('dialog', { name: `Copies of ${entries.bolts.card.name} in ${binder.name}` });
    const copies = within(dialog).getByRole('spinbutton', { name: 'Copies in the group' });
    expect(copies).toHaveValue(2);
    expect(copies).toHaveAttribute('max', String(entries.bolts.quantity));
    await user.clear(copies);
    await user.type(copies, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(`${binder.name} now holds 3 × ${entries.bolts.card.name}`)).toBeInTheDocument();
    expect(api.sent('PUT /api/groups/:id/members/:entry').map((r) => [r.params.id, r.params.entry, r.body])).toEqual([
      [String(binder.id), String(entries.bolts.id), { quantity: 3 }],
    ]);
  });

  it('takes a card out of the group', async () => {
    const { api, user } = renderApp(`/groups/${binder.id}`, { ...groupApi(), 'DELETE /api/groups/:id/members/:entry': { status: 204 } });
    await user.click(await main().findByRole('button', { name: `Actions for ${entries.unpricedElves.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Take out of the group' }));
    expect(await screen.findByText(`Took ${entries.unpricedElves.card.name} out of ${binder.name}`)).toBeInTheDocument();
    expect(api.sent('DELETE /api/groups/:id/members/:entry').map((r) => [r.params.id, r.params.entry])).toEqual([[String(binder.id), String(entries.unpricedElves.id)]]);
  });
});

describe('GroupPage, more', () => {
  it("shows each card's value as the group's copies' value, not the whole entry's", async () => {
    renderApp(`/groups/${binder.id}`, groupApi());
    const bolts = (await main().findByRole('heading', { name: entries.bolts.card.name })).closest('article')!;
    expect(within(bolts).getByText(/^Value/)).toHaveTextContent(`Value ${eur(members[0].value_eur)}`);
    expect(members[0].value_eur).not.toBe(entries.bolts.value_eur);
  });

  it('takes a deleted group out of the groups list at once, before the list is fetched again', async () => {
    let slowList = false;
    const { user } = renderApp('/groups', {
      ...groupApi(),
      'GET /api/groups': async () => {
        if (slowList) await new Promise((resolve) => setTimeout(resolve, 2000));
        return { body: { groups: customGroups } };
      },
      'DELETE /api/groups/:id': { status: 204 },
    });
    await user.click(await main().findByRole('link', { name: `Open ${binder.name}` }));
    slowList = true;
    await user.click(await main().findByRole('button', { name: 'Delete…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('link', { name: `Open ${customGroups[1].name}` })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: `Open ${binder.name}` })).not.toBeInTheDocument();
  });

  it('replaces the deleted group in the history, so Back skips it', async () => {
    const { user, router } = renderApp(`/groups/${binder.id}`, { ...groupApi(), 'DELETE /api/groups/:id': { status: 204 } });
    await user.click(await main().findByRole('button', { name: 'Delete…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('titles its dialogs at the second level, under the page', async () => {
    const { user } = renderApp(`/groups/${binder.id}`, groupApi());
    await user.click(await main().findByRole('button', { name: 'Change…' }));
    expect(screen.getByRole('heading', { level: 2, name: `Change ${binder.name}` })).toBeInTheDocument();
  });

  it("is a fresh page for another group: nothing open on one stays open on the next", async () => {
    const deck = customGroups[1];
    const { user, router, client } = renderApp(`/groups/${binder.id}`, {
      ...groupApi(),
      'GET /api/groups/:id': (req) => ({ body: customGroups.find((g) => String(g.id) === req.params.id) }),
    });
    // Already cached, so the next group's page shows at once, without loading first.
    client.setQueryData(keys.group(deck.id), deck);
    await user.click(await main().findByRole('button', { name: 'Change…' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(() => router.navigate(`/groups/${deck.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: deck.name })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("sends nothing when a card's copies are saved unchanged", async () => {
    const { api, user } = renderApp(`/groups/${binder.id}`, groupApi());
    await user.click(await main().findByRole('button', { name: `Actions for ${entries.bolts.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Change copies…' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.sent('PUT /api/groups/:id/members/:entry')).toHaveLength(0);
  });

  it("says when a card couldn't be taken out", async () => {
    const { user } = renderApp(`/groups/${binder.id}`, {
      ...groupApi(),
      'DELETE /api/groups/:id/members/:entry': { status: 503, body: { error: 'that took too long; try again' } },
    });
    await user.click(await main().findByRole('button', { name: `Actions for ${entries.unpricedElves.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Take out of the group' }));
    expect(await screen.findByText(`Couldn't take ${entries.unpricedElves.card.name} out`)).toBeInTheDocument();
  });

  it('moves focus to the section heading when the card that had it is taken out', async () => {
    let shown = members;
    const { user } = renderApp(`/groups/${binder.id}`, {
      ...groupApi(),
      'GET /api/groups/:id/members': () => ({ body: { members: shown, next_cursor: null } }),
      'DELETE /api/groups/:id/members/:entry': (req) => {
        shown = shown.filter((m) => String(m.entry.id) !== req.params.entry);
        return { status: 204 };
      },
    });
    await user.click(await main().findByRole('button', { name: `Actions for ${entries.unpricedElves.card.name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Take out of the group' }));
    await waitFor(() => expect(main().queryByRole('heading', { name: entries.unpricedElves.card.name })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /^All cards/ })).toHaveFocus());
  });
});
