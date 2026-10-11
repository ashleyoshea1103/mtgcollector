import { Link, NavLink, Outlet, ScrollRestoration, useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/queries';
import { errorMessage } from '../lib/messages';
import { Button, Cluster, toast } from '../ui';

/** Every page's frame: the header with the app's sections and the account, then the page. */
export function AppLayout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = me.data;

  function logOut() {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/'),
      onError: (err) => toast({ title: "Couldn't log out", description: errorMessage(err), tone: 'error' }),
    });
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Cluster justify="space-between" gap={4}>
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
                <NavLink to="/login">Log in</NavLink>
                <NavLink to="/signup">Sign up</NavLink>
              </Cluster>
            )
          )}
        </Cluster>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <ScrollRestoration />
    </>
  );
}
