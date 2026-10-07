import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/** Text for screen readers only: off screen, but still read out and still in the accessibility tree. */
export function VisuallyHidden({ children }: Props) {
  return <span className="visually-hidden">{children}</span>;
}
