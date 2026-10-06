import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import './index.css';
import { Home } from './pages/Home';

const routes: RouteObject[] = [{ path: '/', element: <Home /> }];

// Development-only pages. `import.meta.env.DEV` is false in production builds,
// so these imports (and the fixture data they pull in) are dropped from the bundle.
if (import.meta.env.DEV) {
  routes.push({
    path: '/dev/components',
    lazy: () => import('./pages/ComponentGallery').then((m) => ({ Component: m.ComponentGallery })),
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
