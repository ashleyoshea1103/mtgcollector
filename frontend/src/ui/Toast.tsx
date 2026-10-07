// React Aria's toasts are still marked UNSTABLE_ (react-aria-components 1.21); see toastQueue.ts.
import {
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastRegion as ToastRegion,
} from 'react-aria-components';
import { IconButton } from './Button';
import { toasts, type ToastMessage, type ToastQueue } from './toastQueue';

/**
 * Where toasts appear: a landmark screen-reader users can jump to (F6), announcing each
 * toast as it arrives. Render it once, near the root of the app.
 */
export function Toaster({ queue = toasts }: { queue?: ToastQueue<ToastMessage> }) {
  return (
    <ToastRegion queue={queue} className="toast-region">
      {({ toast: t }) => (
        <AriaToast toast={t} className={`toast toast--${t.content.tone ?? 'info'}`}>
          <ToastContent className="toast__content">
            <Text slot="title" className="toast__title">
              {t.content.title}
            </Text>
            {t.content.description && (
              <Text slot="description" className="toast__description">
                {t.content.description}
              </Text>
            )}
          </ToastContent>
          <IconButton slot="close" label="Dismiss" icon="×" />
        </AriaToast>
      )}
    </ToastRegion>
  );
}
