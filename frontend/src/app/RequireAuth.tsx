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
  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  return <Outlet />;
}
