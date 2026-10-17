import { useState } from 'react';

export interface DisclosureStateOptions {
  /** Controlled open state. Leave undefined to let the disclosure manage it, starting from defaultOpen. */
  open?: boolean;
  defaultOpen?: boolean;
  /** Called when the user opens or closes it (not when a parent changes `open`). */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Open state that can be controlled or not. While controlled it follows `open`, and if the
 * parent stops controlling it, it stays where it was instead of jumping back to defaultOpen.
 */
export function useDisclosureState({ open, defaultOpen = true, onOpenChange }: DisclosureStateOptions): [boolean, (open: boolean) => void] {
  const [ownOpen, setOwnOpen] = useState(open ?? defaultOpen);
  if (open !== undefined && open !== ownOpen) setOwnOpen(open);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return [isOpen, setOpen];
}
