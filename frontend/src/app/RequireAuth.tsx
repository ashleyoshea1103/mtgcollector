import { Fragment } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../api/queries';
import { errorMessage } from '../lib/messages';
import { loginUrl } from '../lib/nextPath';
import { ErrorState, Loading } from '../ui';

/**
 * The pages for a signed-in user. Anyone else is sent to log in, and back here afterwards;
 * that includes someone whose session ends while they're on one of these pages.
 */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  // Only until it's first known: a later check that fails (say, on returning to the tab)
  // mustn't take the page away, with whatever was being typed in it.
  if (me.data === undefined) return me.isError ? <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} /> : <Loading />;
  if (me.data === null) return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  // Someone else signed in (in another tab) starts the page afresh: nothing the last user had
  // open on it (a card shown larger, a form) is left over theirs.
  return (
    <Fragment key={me.data.id}>
      <Outlet />
    </Fragment>
  );
}
