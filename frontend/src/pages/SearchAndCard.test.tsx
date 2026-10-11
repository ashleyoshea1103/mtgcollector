import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, customGroups, entries, makeEntry } from '../fixtures';
import { keys } from '../api/keys';
import { renderApp, signedIn, signedOut, type Routes } from '../test/app';
import type { Card, CardPage } from '../types';

const { lightningBolt, ragavan, delver } = cards;
// Another printing of Lightning Bolt: the same card from another set.
const otherBolt: Card = { ...lightningBolt, id: '00000000-0000-4000-8000-0000000000b2', set: { ...ragavan.set }, collector_number: '7', released_at: '2021-06-18' };
const page = (list: Card[], n = 1, more = false): CardPage => ({ cards: list, page: n, has_more: more });

const searchApi: Routes = {
  'GET /api/cards/search': (req) => ({ body: page(req.query.get('q') === 'bolt' ? [lightningBolt] : [ragavan, delver]) }),
  'GET /api/cards/:id/printings': { body: page([otherBolt, lightningBolt]) },
};
const main = () => within(screen.getByRole('main'));

describe('SearchPage', () => {
  it('asks for enough of a name before searching', async () => {
    const { api, user } = renderApp('/search', { ...signedOut, ...searchApi });
    expect(await main().findByText("Type at least 3 letters of a card's name, or a set code.")).toBeInTheDocument();
    await user.type(main().getByRole('searchbox', { name: 'Card name' }), 'bo{Enter}');
    expect(main().getByText(/Type at least 3 letters/)).toBeInTheDocument();
    expect(api.sent('GET /api/cards/search')).toHaveLength(0);
  });

  it('searches as you type, keeping the search in the URL', async () => {
    const { api, user, location } = renderApp('/search', { ...signedOut, ...searchApi });
    const box = await main().findByRole('searchbox', { name: 'Card name' });
    await user.type(box, 'bolt');
    expect(await main().findByRole('heading', { name: lightningBolt.name })).toBeInTheDocument();
    expect(location().search).toBe('?q=bolt');
    // Writing the URL doesn't start the form afresh: the box keeps its text and focus.
    expect(box).toHaveValue('bolt');
    expect(box).toHaveFocus();
    expect(api.sent('GET /api/cards/search').map((r) => r.query.toString())).toEqual(['q=bolt&page=1']);
    expect(main().getByRole('link', { name: `Details of ${lightningBolt.name}` })).toHaveAttribute('href', `/cards/${lightningBolt.id}`);
  });

  it('runs the search in the URL, with its filters', async () => {
    const { api } = renderApp('/search?q=ragav&rarity=mythic&colors=R&extras=true', { ...signedOut, ...searchApi });
    expect(await main().findByRole('heading', { name: ragavan.name })).toBeInTheDocument();
    expect(api.sent('GET /api/cards/search')[0].query.toString()).toBe('q=ragav&rarity=mythic&colors=R&extras=true&page=1');
    expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue('ragav');
    expect(main().getByRole('combobox', { name: 'Rarity' })).toHaveValue('mythic');
    expect(main().getByRole('checkbox', { name: 'Red' })).toBeChecked();
    expect(main().getByRole('checkbox', { name: /Include tokens/ })).toBeChecked();
  });

  it('filters by rarity and colors, colourless being on its own', async () => {
    const { user, location } = renderApp('/search?q=ragav', { ...signedOut, ...searchApi });
    await main().findByRole('heading', { name: ragavan.name });
    await user.selectOptions(main().getByRole('combobox', { name: 'Rarity' }), 'Rare');
    await user.click(main().getByRole('checkbox', { name: 'Green' }));
    await user.click(main().getByRole('checkbox', { name: 'White' }));
    expect(location().search).toBe('?q=ragav&rarity=rare&colors=WG');
    await user.click(main().getByRole('checkbox', { name: 'Colorless' }));
    expect(location().search).toBe('?q=ragav&rarity=rare&colors=C');
    expect(main().getByRole('checkbox', { name: 'White' })).not.toBeChecked();
    await user.click(main().getByRole('checkbox', { name: 'Blue' }));
    expect(location().search).toBe('?q=ragav&rarity=rare&colors=U');
  });

  it("doesn't search with a set code that can't be one", async () => {
    const { api, user } = renderApp('/search', { ...signedOut, ...searchApi });
    const set = await main().findByRole('searchbox', { name: 'Set code' });
    await user.type(set, 'mh-2{Enter}');
    expect(set).toHaveAccessibleDescription('A set code is letters and digits, like mh2.');
    expect(api.sent('GET /api/cards/search')).toHaveLength(0);
  });

  it('shows more results, each card once', async () => {
    const { api, user } = renderApp('/search?q=elves', {
      ...signedOut,
      'GET /api/cards/search': (req) => ({ body: req.query.get('page') === '2' ? page([delver, cards.propaganda], 2) : page([ragavan, delver], 1, true) }),
    });
    await user.click(await main().findByRole('button', { name: 'Show more' }));
    expect(await main().findByRole('heading', { name: cards.propaganda.name })).toBeInTheDocument();
    expect(main().getAllByRole('heading', { name: delver.name })).toHaveLength(1);
    expect(api.sent('GET /api/cards/search').map((r) => r.query.get('page'))).toEqual(['1', '2']);
    expect(main().queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    renderApp('/search?q=zzzz', { ...signedOut, 'GET /api/cards/search': { body: page([]) } });
    expect(await main().findByText('No cards match')).toBeInTheDocument();
  });

  it("shows the server's reason a search failed", async () => {
    renderApp('/search?q=bolt', { ...signedOut, 'GET /api/cards/search': { status: 400, body: { error: "that's longer than any card's name or type" } } });
    expect(await main().findByRole('alert')).toHaveTextContent("That's longer than any card's name or type.");
  });

  it('starts the text boxes afresh when going back to an earlier search', async () => {
    const { user, router } = renderApp('/search?q=bolt', { ...signedOut, ...searchApi });
    await main().findByRole('heading', { name: lightningBolt.name });
    await user.click(main().getByRole('link', { name: `Details of ${lightningBolt.name}` }));
    await router.navigate('/search?q=ragav');
    await main().findByRole('heading', { name: ragavan.name });
    expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue('ragav');
    await router.navigate(-2);
    await main().findByRole('heading', { name: lightningBolt.name });
    expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue('bolt');
  });

  it('starts the text boxes afresh when a link leads to another search', async () => {
    const { user, location } = renderApp('/search?q=bolt&set=m10', { ...signedOut, ...searchApi });
    await main().findByRole('heading', { name: lightningBolt.name });
    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Search' }));
    await waitFor(() => expect(location().search).toBe(''));
    expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue('');
    expect(main().getByRole('searchbox', { name: 'Set code' })).toHaveValue('');
  });

  it('puts back the text of a search typed earlier when going back to it', async () => {
    const { user, router } = renderApp('/search', { ...signedOut, ...searchApi });
    await user.type(await main().findByRole('searchbox', { name: 'Card name' }), 'bolt');
    await main().findByRole('heading', { name: lightningBolt.name });
    await user.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Search' }));
    await waitFor(() => expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue(''));
    await router.navigate(-1);
    await waitFor(() => expect(main().getByRole('searchbox', { name: 'Card name' })).toHaveValue('bolt'));
  });

  it('says to correct a set code that cannot be one, rather than to type a name', async () => {
    renderApp('/search?q=bolt&set=mh-2', { ...signedOut, ...searchApi });
    expect(await main().findByText('Correct the set code to search.')).toBeInTheDocument();
    expect(main().queryByText(/Type at least/)).not.toBeInTheDocument();
  });

  it('asks visitors to log in to add cards', async () => {
    renderApp('/search?q=bolt', { ...signedOut, ...searchApi });
    await main().findByRole('heading', { name: lightningBolt.name });
    expect(main().queryByRole('button', { name: `Add ${lightningBolt.name}` })).not.toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Log in' })).toHaveAttribute('href', `/login?next=${encodeURIComponent('/search?q=bolt')}`);
  });

  describe('adding a card', () => {
    const adding: Routes = {
      ...signedIn,
      ...searchApi,
      'GET /api/groups': { body: { groups: customGroups } },
      'POST /api/collection/entries': (req) => ({ status: 201, body: makeEntry(50, req.body.card_id === otherBolt.id ? otherBolt : lightningBolt, { quantity: req.body.quantity }) }),
    };

    it('adds the chosen printing, finish and group', async () => {
      const { api, user } = renderApp('/search?q=bolt', adding);
      await user.click(await main().findByRole('button', { name: `Add ${lightningBolt.name}` }));
      const dialog = screen.getByRole('dialog', { name: `Add ${lightningBolt.name}` });
      // The printing found is chosen; another can be.
      const printing = await within(dialog).findByRole('button', { name: new RegExp(`${otherBolt.set.name}.*#7`) });
      await user.click(printing);
      expect(printing).toHaveAttribute('aria-pressed', 'true');
      expect(within(dialog).getByText(new RegExp(`${otherBolt.set.name} #7`))).toBeInTheDocument();

      const quantity = within(dialog).getByRole('spinbutton', { name: 'Quantity' });
      await user.clear(quantity);
      await user.type(quantity, '3');
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Add to group' }), customGroups[0].name);
      await user.click(within(dialog).getByRole('button', { name: 'Add to collection' }));

      expect(await screen.findByText(`Added 3 × ${lightningBolt.name}`)).toBeInTheDocument();
      expect(screen.getByText(`Also in ${customGroups[0].name}.`)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.sent('POST /api/collection/entries').map((r) => r.body)).toEqual([
        { card_id: otherBolt.id, quantity: 3, finish: 'nonfoil', condition: 'NM', language: 'en', group_id: customGroups[0].id },
      ]);
    });

    it('says when the copies went into an entry already there', async () => {
      const { user } = renderApp('/search?q=bolt', {
        ...adding,
        'POST /api/collection/entries': { status: 200, body: { ...entries.bolts, quantity: 5 } },
      });
      await user.click(await main().findByRole('button', { name: `Add ${lightningBolt.name}` }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to collection' }));
      expect(await screen.findByText(`Added 1 more × ${lightningBolt.name}, now 5`)).toBeInTheDocument();
    });

    it('says why adding failed, and stays open', async () => {
      const { user } = renderApp('/search?q=bolt', {
        ...adding,
        'POST /api/collection/entries': { status: 400, body: { error: 'your collection is full: it holds at most 50000 entries' } },
      });
      await user.click(await main().findByRole('button', { name: `Add ${lightningBolt.name}` }));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Add to collection' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your collection is full: it holds at most 50000 entries.');
    });
  });
});

describe('CardPage', () => {
  const cardApi: Routes = {
    'GET /api/cards/:id': (req) => (req.params.id === delver.id ? { body: delver } : { status: 404, body: { error: 'no card with that id' } }),
    'GET /api/cards/:id/printings': { body: page([delver, { ...delver, id: 'older', collector_number: '51', released_at: '2011-09-30' }]) },
  };

  it('shows the printing in full, and its other printings', async () => {
    const { api } = renderApp(`/cards/${delver.id}`, { ...signedOut, ...cardApi });
    expect(await main().findByRole('heading', { level: 1, name: delver.name })).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 2, name: 'Prices' })).toBeInTheDocument();
    const printings = within(await main().findByRole('region', { name: 'Printings' }));
    expect(printings.getByText(/\(this one\)/)).toBeInTheDocument();
    expect(printings.getByRole('link', { name: /#51/ })).toHaveAttribute('href', '/cards/older');
    // Nobody's signed in: no copies to ask for.
    expect(api.sent('GET /api/collection/cards/:id')).toHaveLength(0);
    expect(main().getByRole('link', { name: 'Log in' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/cards/${delver.id}`)}`);
  });

  it('shows no copies once nobody is signed in, though some are still cached', async () => {
    const { client } = renderApp(`/cards/${delver.id}`, { ...signedOut, ...cardApi });
    client.setQueryData(keys.copies(delver.id), { entries: [entries.germanDelver] });
    expect(await main().findByRole('heading', { level: 1, name: delver.name })).toBeInTheDocument();
    expect(main().queryByRole('heading', { name: 'In your collection' })).not.toBeInTheDocument();
  });

  it("shows the user's copies, and adds more of this printing", async () => {
    const { api, user } = renderApp(`/cards/${delver.id}`, {
      ...signedIn,
      ...cardApi,
      'GET /api/collection/cards/:id': { body: { entries: [entries.germanDelver] } },
      'GET /api/groups': { body: { groups: [] } },
      'POST /api/collection/entries': { status: 201, body: makeEntry(51, delver, { finish: 'foil' }) },
    });
    const owned = (await main().findByRole('heading', { name: 'In your collection' })).parentElement!;
    expect(owned).toHaveTextContent('2× Non-foil, Excellent, German');
    expect(api.sent('GET /api/collection/cards/:id').map((r) => r.params.id)).toEqual([delver.id]);

    await user.click(main().getByRole('button', { name: 'Add to collection' }));
    const dialog = screen.getByRole('dialog', { name: `Add ${delver.name}` });
    // The page's printing is the one added: no other printings are offered.
    expect(within(dialog).queryByRole('region', { name: 'Printings' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Finish' }), 'Foil');
    await user.click(within(dialog).getByRole('button', { name: 'Add to collection' }));
    await waitFor(() => expect(api.sent('POST /api/collection/entries').map((r) => r.body.card_id + ' ' + r.body.finish)).toEqual([`${delver.id} foil`]));
    // The copies are asked for again, to show the new one.
    await waitFor(() => expect(api.sent('GET /api/collection/cards/:id')).toHaveLength(2));
  });

  it.each([
    ['no card with that id', 404, 'no card with that id'],
    ["an id that isn't a Scryfall id", 400, 'card id must be a Scryfall id'],
  ])('says the card is not found for %s', async (_, status, error) => {
    renderApp('/cards/nope', { ...signedOut, 'GET /api/cards/:id': { status, body: { error } }, 'GET /api/cards/:id/printings': { body: page([]) } });
    expect(await main().findByRole('heading', { level: 1, name: 'Card not found' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Search for cards' })).toHaveAttribute('href', '/search');
  });
});

describe('SearchPage, more', () => {
  it('has a heading for the results', async () => {
    renderApp('/search?q=bolt', { ...signedOut, ...searchApi });
    expect(await main().findByRole('heading', { level: 2, name: 'Results' })).toBeInTheDocument();
  });

  it("keeps the last results up, marked busy, while the next search runs", async () => {
    const { user } = renderApp('/search?q=bolt', {
      ...signedOut,
      'GET /api/cards/search': async (req) => {
        if (req.query.get('q') === 'boltx') await new Promise((resolve) => setTimeout(resolve, 300));
        return { body: page([lightningBolt]) };
      },
    });
    await main().findByRole('heading', { name: lightningBolt.name });
    await user.type(main().getByRole('searchbox', { name: 'Card name' }), 'x{Enter}');
    await waitFor(() => expect(main().getByRole('heading', { level: 2, name: 'Results' }).parentElement).toHaveAttribute('aria-busy', 'true'));
    expect(main().getByRole('heading', { name: lightningBolt.name })).toBeInTheDocument();
  });

  it("asks to log in when it can't tell who's signed in", async () => {
    renderApp('/search?q=bolt', { ...searchApi, 'GET /api/auth/me': { status: 503, body: { error: 'that took too long; try again' } } });
    expect(await main().findByText(/to add cards to your collection/)).toBeInTheDocument();
  });

  it('replaces the history entry as the search changes, rather than adding one per pause in typing', async () => {
    const { user, router } = renderApp('/search', { ...signedOut, ...searchApi });
    await user.type(await main().findByRole('searchbox', { name: 'Card name' }), 'bolt{Enter}');
    await waitFor(() => expect(router.state.location.search).toBe('?q=bolt'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it("says when the user's groups couldn't be loaded, so the add form has none", async () => {
    const { user } = renderApp('/search?q=bolt', {
      ...signedIn,
      ...searchApi,
      'GET /api/groups': { status: 503, body: { error: 'that took too long; try again' } },
    });
    await user.click(await main().findByRole('button', { name: `Add ${lightningBolt.name}` }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/Couldn't load your groups/)).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Which printing?' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { level: 2, name: `Add ${lightningBolt.name}` })).toBeInTheDocument();
  });
});

describe('CardPage, more', () => {
  it("says when the user's copies couldn't be loaded", async () => {
    renderApp(`/cards/${delver.id}`, {
      ...signedIn,
      'GET /api/cards/:id': { body: delver },
      'GET /api/cards/:id/printings': { body: page([delver]) },
      'GET /api/collection/cards/:id': { status: 503, body: { error: 'that took too long; try again' } },
    });
    expect(await main().findByText("Couldn't load your copies. That took too long; try again.")).toBeInTheDocument();
  });
});
