import type { RouteObject } from 'react-router';
import { AuthPage } from '../pages/AuthPage';
import { CardPage } from '../pages/CardPage';
import { CollectionPage } from '../pages/CollectionPage';
import { GroupPage } from '../pages/GroupPage';
import { GroupsPage } from '../pages/GroupsPage';
import { Home } from '../pages/Home';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SearchPage } from '../pages/SearchPage';
import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';
import { RouteError } from './RouteError';

/** The app's pages, in their frame. main.tsx adds the development-only gallery beside them. */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    // Only if the frame itself fails.
    errorElement: <RouteError />,
    children: [
      {
        // A page that fails shows the error in its place, under the header.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Home /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'cards/:id', element: <CardPage /> },
          { path: 'login', element: <AuthPage mode="login" /> },
          { path: 'signup', element: <AuthPage mode="signup" /> },
          {
            element: <RequireAuth />,
            children: [
              { path: 'collection', element: <CollectionPage /> },
              { path: 'groups', element: <GroupsPage /> },
              { path: 'groups/:id', element: <GroupPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
