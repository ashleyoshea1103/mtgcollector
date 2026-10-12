import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/queries';
import { errorMessage } from '../lib/messages';
import { Button, Cluster, toast } from '../ui';
import { ThemeToggle } from './ThemeToggle';

/** Every page's frame: the header with the app's sections and the account, then the page. */
export function AppLayout() {
  const me = useMe();
  const navigate = useNavigate();
  // Off any page that needs an account before the user is forgotten, or it would send them to log in.
  const logout = useLogout(() => navigate('/search', { flushSync: true }));
  const location = useLocation();
  const user = me.data;
  // Logging in or signing up comes back to this page afterwards; from those pages themselves,
  // to wherever they were going to come back to.
  const comeBack = /^\/(login|signup)$/.test(location.pathname)
    ? location.search
    : location.pathname === '/'
      ? ''
      : `?next=${encodeURIComponent(location.pathname + location.search)}`;

  // A new page moves focus to it, so screen readers start there rather than where the old one was.
  const main = useRef<HTMLElement>(null);
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  function logOut() {
    logout.mutate(undefined, {
      onError: (err) => toast({ title: "Couldn't log out", description: errorMessage(err), tone: 'error' }),
    });
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Cluster className="app-header__bar" justify="space-between" gap={4}>
          <Link to="/" className="app-header__home">
            mtgcollector
          </Link>
          <nav aria-label="Main" className="app-header__nav">
            <Cluster as="ul" gap={4}>
              <li>
                <NavLink to="/search">Search</NavLink>
              </li>
              {user && (
                <>
                  <li>
                    <NavLink to="/collection">Collection</NavLink>
                  </li>
                  <li>
                    <NavLink to="/groups">Groups</NavLink>
                  </li>
                </>
              )}
            </Cluster>
          </nav>
          {/* Nothing until it's known who's signed in, rather than a flash of the wrong links; if that
              can't be found out, the links to log in (the login page sends anyone signed in on). */}
          {user ? (
            <Cluster className="app-header__account">
              <span className="app-header__email">{user.email}</span>
              <Button onPress={logOut} busy={logout.isPending}>
                {logout.isPending ? 'Logging out…' : 'Log out'}
              </Button>
            </Cluster>
          ) : (
            (user === null || me.isError) && (
              <Cluster className="app-header__account">
                <NavLink to={`/login${comeBack}`}>Log in</NavLink>
                <NavLink to={`/signup${comeBack}`}>Sign up</NavLink>
              </Cluster>
            )
          )}
          <ThemeToggle />
        </Cluster>
      </header>
      <main id="main" ref={main} className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  );
}
