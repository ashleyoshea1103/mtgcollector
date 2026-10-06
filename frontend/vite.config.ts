import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // A stray .only would silently skip every other test; fail instead, locally as well as in CI.
    allowOnly: false,
    // The two test projects map to the unit and behaviour stages of scripts/verify.sh.
    projects: [
      {
        extends: true,
        test: {
          // Pure logic: *.test.ts, no DOM.
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          // Components rendered in jsdom and driven as a user would: *.test.tsx.
          name: 'behaviour',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
