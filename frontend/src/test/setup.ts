import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom has no scrolling; React Router's ScrollRestoration scrolls on each navigation.
window.scrollTo = () => {};
