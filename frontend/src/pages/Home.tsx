import { Navigate } from 'react-router';
import { useMe } from '../api/queries';
import { Loading } from '../ui';

/** The start: your collection when you're signed in, else the card search. */
export function Home() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  return <Navigate to={me.data ? '/collection' : '/search'} replace />;
}
