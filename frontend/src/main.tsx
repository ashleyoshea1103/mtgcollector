import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
// Tokens first: the other stylesheets use them.
import './styles/tokens.css';
import './ui/ui.css';
import './index.css';
import { Home } from './pages/Home';
import { Toaster } from './ui';

const routes: RouteObject[] = [{ path: '/', element: <Home /> }];

// Development-only pages. `import.meta.env.DEV` is false in production builds,
// so these imports (and the fixture data they pull in) are dropped from the bundle.
if (import.meta.env.DEV) {
  routes.push({
    path: '/dev/components',
    lazy: () => import('./pages/ComponentGallery').then((m) => ({ Component: m.ComponentGallery })),
    hydrateFallbackElement: <p>Loading…</p>,
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
    <Toaster />
  </StrictMode>,
);
