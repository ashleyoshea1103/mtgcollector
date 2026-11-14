import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, Stack } from '../ui';

/**
 * Shown in place of a page that failed to render (a bug, or data it couldn't handle). The
 * header stays, so the rest of the app is still a click away. The error itself isn't shown:
 * it may be internal details. (React Router reports it to the console.)
 */
export function RouteError() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <Stack className="route-error" as="section">
      <title>{missing ? 'Page not found · mtgcollector' : 'Something went wrong · mtgcollector'}</title>
      <h1>{missing ? 'Page not found' : 'Something went wrong'}</h1>
      <p>{missing ? "There's no page at this address." : "This page couldn't be shown. Reloading may fix it."}</p>
      <p>
        {!missing && <Button onPress={() => window.location.reload()}>Reload</Button>} <Link to="/">Go to the start</Link>
      </p>
    </Stack>
  );
}
