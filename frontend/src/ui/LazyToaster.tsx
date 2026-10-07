import { lazy, Suspense } from 'react';

const Toaster = lazy(() => import('./Toast').then((m) => ({ default: m.Toaster })));

/**
 * The Toaster, loaded in its own chunk after first paint: nothing on screen at load needs
 * it, and toast() queues any toasts shown before it arrives (see toastQueue.ts).
 */
export function LazyToaster() {
  return (
    <Suspense>
      <Toaster />
    </Suspense>
  );
}
