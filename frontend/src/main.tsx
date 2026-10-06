import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './index.css';
import { ComponentGallery } from './pages/ComponentGallery';
import { Home } from './pages/Home';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/dev/components', element: <ComponentGallery /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
