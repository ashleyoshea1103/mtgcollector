import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Modules that exist only for development: the component gallery and its fixture data. */
const DEV_ONLY_MODULES = /[\\/]src[\\/](fixtures[\\/]|pages[\\/](ComponentGallery\.tsx|PrimitivesGallery\.tsx|gallerySections\.ts)|devOnly\.ts)/;

/** Fails a production build that bundles any dev-only module, however it got imported. */
function forbidDevOnlyModules(): Plugin {
  return {
    name: 'forbid-dev-only-modules',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const devOnly = chunk.moduleIds.filter((id) => DEV_ONLY_MODULES.test(id));
        if (devOnly.length > 0) {
          this.error(`dev-only modules in the production bundle (${chunk.fileName}):\n  ${devOnly.join('\n  ')}`);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), forbidDevOnlyModules()],
  server: {
    // The app calls the API on its own origin, as it will in production: in development,
    // Vite forwards /api to the Go server (backend/cmd/server, default 127.0.0.1:8080). An IP,
    // not "localhost", which can resolve to ::1 while the server listens on IPv4 only.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
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
