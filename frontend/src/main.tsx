import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, type RouteObject } from 'react-router';
// The DOM build: it can commit a navigation at once (flushSync), which logging out needs.
import { RouterProvider } from 'react-router/dom';
// Tokens first: the other stylesheets use them.
import './styles/tokens.css';
import './ui/ui.css';
import './index.css';
import { createQueryClient } from './api/queryClient';
import { routes } from './app/routes';
import { LazyToaster } from './ui/LazyToaster';

const all: RouteObject[] = [...routes];

// Development-only pages. `import.meta.env.DEV` is false in production builds,
// so these imports (and the fixture data they pull in) are dropped from the bundle.
if (import.meta.env.DEV) {
  all.unshift({
    path: '/dev/components',
    lazy: () => import('./pages/ComponentGallery').then((m) => ({ Component: m.ComponentGallery })),
    hydrateFallbackElement: <p>Loading…</p>,
  });
}

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createBrowserRouter(all)} />
    </QueryClientProvider>
    <LazyToaster />
  </StrictMode>,
);
