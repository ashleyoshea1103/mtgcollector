// React Aria's toasts are still marked UNSTABLE_ (react-aria-components 1.21); they're only
// imported here and in Toast.tsx, so a rename when they stabilise stays in src/ui.
import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';

export interface ToastMessage {
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'error';
}

export type { ToastQueue };

export function createToastQueue() {
  return new ToastQueue<ToastMessage>({ maxVisibleToasts: 3 });
}

/** The app's toasts. Show one with toast(); <Toaster /> displays them. */
export const toasts = createToastQueue();

/**
 * Shows a short message, e.g. "Added 4 × Lightning Bolt". It closes itself after
 * `timeout` ms (at least 5 seconds, so it can be read) unless it's an error, which stays
 * until dismissed. Returns its key, for toasts.close(key).
 */
export function toast(message: ToastMessage, { timeout, queue = toasts }: { timeout?: number; queue?: ToastQueue<ToastMessage> } = {}) {
  return queue.add(message, { timeout: message.tone === 'error' ? undefined : Math.max(timeout ?? 5000, 5000) });
}
