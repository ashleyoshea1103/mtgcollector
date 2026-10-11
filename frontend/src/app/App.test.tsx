import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stats } from '../fixtures';
import { ann, renderApp, signedIn, signedOut, type Routes } from '../test/app';
import { keys } from '../api/keys';

const emptyCollection: Routes = {
  'GET /api/collection/stats': { body: stats },
  'GET /api/collection/groups': { body: { group_by: 'none', groups: [] } },
};

const header = () => within(screen.getByRole('banner'));

describe('the app frame', () => {
  it('offers search, logging in and signing up to visitors, and starts them at the search', async () => {
    const { location } = renderApp('/', signedOut);
    expect(await screen.findByRole('heading', { level: 1, name: 'Search cards' })).toBeInTheDocument();
    expect(location().pathname).toBe('/search');
    expect(header().getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    expect(header().queryByRole('link', { name: 'Collection' })).not.toBeInTheDocument();
  });

  it('starts signed-in users at their collection, with their sections and account', async () => {
    const { location } = renderApp('/', { ...signedIn, ...emptyCollection });
    expect(await screen.findByRole('heading', { level: 1, name: 'Your collection' })).toBeInTheDocument();
    expect(location().pathname).toBe('/collection');
    expect(header().getByRole('link', { name: 'Collection' })).toHaveAttribute('aria-current', 'page');
    expect(header().getByRole('link', { name: 'Groups' })).toBeInTheDocument();
    expect(header().getByText(ann.email)).toBeInTheDocument();
    expect(header().queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(header().getByRole('button', { name: 'Light theme' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Add cards' })).toHaveAttribute('href', '/search');
  });

  it("offers logging in when it can't tell who's signed in", async () => {
    renderApp('/search', { 'GET /api/auth/me': { status: 503, body: { error: 'that took too long; try again' } } });
    expect(await header().findByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });

  it('lets keyboard users skip to the page', async () => {
    renderApp('/search', signedOut);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('says when there is no page at an address', async () => {
    renderApp('/no/such/page', signedOut);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the start' })).toHaveAttribute('href', '/');
  });

  describe('a page that fails to render', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows an error in its place, keeping the header, without the error itself', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Totals missing their breakdowns: the summary can't render them.
      renderApp('/collection', { ...signedIn, ...emptyCollection, 'GET /api/collection/stats': { body: { card_count: 1 } } });
      expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
      expect(header().getByRole('link', { name: 'Collection' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(screen.queryByText(/undefined|TypeError/)).not.toBeInTheDocument();
    });
  });
});

describe('signing in', () => {
  it('sends visitors to log in from a page that needs an account, then back to it', async () => {
    let user: typeof ann | null = null;
    const { api, user: u, location } = renderApp('/collection?group_by=set', {
      'GET /api/auth/me': () => (user ? { body: user } : { status: 401, body: { error: 'not signed in' } }),
      'POST /api/auth/login': () => {
        user = ann;
        return { body: ann };
      },
      ...emptyCollection,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(location().pathname).toBe('/login');
    expect(location().search).toBe(`?next=${encodeURIComponent('/collection?group_by=set')}`);

    await u.type(screen.getByRole('textbox', { name: 'Email' }), ' ann@example.com ');
    await u.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await u.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your collection' })).toBeInTheDocument();
    expect(location().pathname + location().search).toBe('/collection?group_by=set');
    expect(api.sent('POST /api/auth/login').map((r) => r.body)).toEqual([{ email: 'ann@example.com', password: 'correct horse battery staple' }]);
    expect(header().getByText(ann.email)).toBeInTheDocument();
  });

  it("forgets a failed attempt's password once the login page is left", async () => {
    const { user, client } = renderApp('/login', { ...signedOut, 'POST /api/auth/login': { status: 401, body: { error: 'email or password is incorrect' } } });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'a nearly right password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    await user.click(header().getByRole('link', { name: 'Search' }));
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });

  it("says why logging in failed and stays put", async () => {
    const { user, location } = renderApp('/login', {
      ...signedOut,
      'POST /api/auth/login': { status: 401, body: { error: 'email or password is incorrect' } },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password typed here');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(location().pathname).toBe('/login');
  });

  it('ignores a next page on another site', async () => {
    const { user, location } = renderApp(`/login?next=${encodeURIComponent('//evil.example/x')}`, {
      ...signedOut,
      ...emptyCollection,
      'POST /api/auth/login': { body: ann },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(location().pathname).toBe('/collection'));
  });

  it('sends someone already signed in on from the login page', async () => {
    const { location } = renderApp('/login?next=%2Fgroups', { ...signedIn, 'GET /api/groups': { body: { groups: [] } } });
    await waitFor(() => expect(location().pathname).toBe('/groups'));
  });

  it('makes an account, checking the password length first', async () => {
    const { api, user, location } = renderApp('/signup', {
      ...signedOut,
      ...emptyCollection,
      'POST /api/auth/signup': { status: 201, body: ann },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    const password = screen.getByLabelText('Password');
    await user.type(password, 'too short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(password).toHaveAccessibleDescription(expect.stringContaining('Use at least 15 characters.'));
    expect(api.sent('POST /api/auth/signup')).toHaveLength(0);

    await user.type(password, ' but now long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(location().pathname).toBe('/collection'));
    expect(api.sent('POST /api/auth/signup').map((r) => r.body)).toEqual([{ email: 'ann@example.com', password: 'too short but now long enough' }]);
  });

  it('says when an email already has an account', async () => {
    const { user } = renderApp('/signup', {
      ...signedOut,
      'POST /api/auth/signup': { status: 409, body: { error: 'an account with that email already exists' } },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An account with that email already exists.');
  });

  it("doesn't carry a failed login's message to the sign-up page and back", async () => {
    const { user } = renderApp('/login', { ...signedOut, 'POST /api/auth/login': { status: 401, body: { error: 'email or password is incorrect' } } });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password typed here');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Sign up' }));
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('');
  });

  it('links between logging in and signing up, keeping the next page', async () => {
    const { user, location } = renderApp('/login?next=%2Fgroups', signedOut);
    await user.click(await within(screen.getByRole('main')).findByRole('link', { name: 'Sign up' }));
    expect(location().pathname + location().search).toBe('/signup?next=%2Fgroups');
    expect(screen.getByRole('heading', { level: 1, name: 'Create an account' })).toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('logs out, forgetting everything about the user', async () => {
    const { api, user, client, location } = renderApp('/collection', {
      ...signedIn,
      ...emptyCollection,
      'POST /api/auth/logout': { status: 204 },
    });
    await screen.findByRole('heading', { level: 1, name: 'Your collection' });
    expect(client.getQueryData(keys.stats)).toBeDefined();

    await user.click(header().getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(location().pathname).toBe('/search'));
    expect(api.sent('POST /api/auth/logout')).toHaveLength(1);
    expect(client.getQueryData(keys.stats)).toBeUndefined();
    expect(client.getQueryData(keys.me)).toBeNull();
    expect(header().getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });

  it('says when logging out failed, and stays signed in', async () => {
    const { user } = renderApp('/search', { ...signedIn, 'POST /api/auth/logout': { status: 503, body: { error: 'that took too long; try again' } } });
    await user.click(await header().findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText("Couldn't log out")).toBeInTheDocument();
    expect(header().getByText(ann.email)).toBeInTheDocument();
  });

  it('sends the user to log in when their session ends, then back', async () => {
    const { location } = renderApp('/collection?view=list', {
      ...signedIn,
      'GET /api/collection/stats': { status: 401, body: { error: 'not signed in' } },
      'GET /api/collection/groups': { status: 401, body: { error: 'not signed in' } },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(new URLSearchParams(location().search).get('next')).toBe('/collection?view=list');
    expect(header().queryByText(ann.email)).not.toBeInTheDocument();
  });
});

describe("who's signed in, while it's checked", () => {
  it("doesn't take a page away when a later check fails", async () => {
    let fail = false;
    const { client } = renderApp('/collection', {
      ...emptyCollection,
      'GET /api/auth/me': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: ann }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Your collection' });
    fail = true;
    await act(() => client.refetchQueries({ queryKey: keys.me }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your collection' })).toBeInTheDocument();
  });

  it("says so when the first check fails, and checks again on request", async () => {
    let fail = true;
    const { user } = renderApp('/collection', {
      ...emptyCollection,
      'GET /api/auth/me': () => (fail ? { status: 503, body: { error: 'that took too long; try again' } } : { body: ann }),
    });
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent('That took too long; try again.');
    fail = false;
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your collection' })).toBeInTheDocument();
  });

  it('shows no account links until it knows', async () => {
    renderApp('/search', { 'GET /api/auth/me': () => new Promise(() => {}) });
    await screen.findByRole('heading', { level: 1, name: 'Search cards' });
    expect(header().queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
    expect(screen.queryByText(/to add cards to your collection/)).not.toBeInTheDocument();
  });

  it("logging in from the header comes back to the page it's on", async () => {
    renderApp('/search?q=bolt', { ...signedOut, 'GET /api/cards/search': { body: { cards: [], page: 1, has_more: false } } });
    const next = encodeURIComponent('/search?q=bolt');
    expect(await header().findByRole('link', { name: 'Log in' })).toHaveAttribute('href', `/login?next=${next}`);
    expect(header().getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', `/signup?next=${next}`);
  });
});

describe('moving between pages', () => {
  it('moves focus to the new page, for screen readers', async () => {
    const { user } = renderApp('/collection', { ...signedIn, ...emptyCollection, 'GET /api/groups': { body: { groups: [] } } });
    await screen.findByRole('heading', { level: 1, name: 'Your collection' });
    expect(screen.getByRole('main')).not.toHaveFocus();
    await user.click(header().getByRole('link', { name: 'Groups' }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });
});

describe('form checks', () => {
  it('moves focus to a new password that is too short, which reads out why', async () => {
    const { user } = renderApp('/signup', signedOut);
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'too short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });
});
