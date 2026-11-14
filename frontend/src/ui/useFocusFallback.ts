import { useEffect, useEffectEvent, useRef, type FocusEvent } from 'react';

/**
 * Keeps focus from falling to the page when the element that had it, inside a part of the
 * page, goes away: e.g. a card removed from a list, along with the button that removed it.
 * Spread the result on the part's element. Whenever `changed` changes (the part's data),
 * if focus has fallen to the page and the element last focused in the part is gone, the
 * part's `fallback` (e.g. its heading's button) gets focus instead.
 */
export function useFocusFallback<T extends HTMLElement>(fallback: (part: T) => HTMLElement | null | undefined, changed: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<Element | null>(null);

  const refocus = useEffectEvent(() => {
    const part = ref.current;
    const doc = part?.ownerDocument;
    if (!part || !doc || !last.current || last.current.isConnected) return;
    if (doc.activeElement !== null && doc.activeElement !== doc.body) return;
    last.current = null;
    fallback(part)?.focus();
  });
  useEffect(() => refocus(), [changed]);

  return {
    ref,
    onFocus: (e: FocusEvent<T>) => {
      last.current = e.target;
    },
  };
}
