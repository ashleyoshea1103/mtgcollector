import type { ReactNode } from 'react';
import { IconButton } from './Button';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

/** A small label or count, e.g. "4×" on a card or "Foil". */
export function Badge({ tone = 'neutral', className, children }: BadgeProps) {
  return <span className={['badge', `badge--${tone}`, className].filter(Boolean).join(' ')}>{children}</span>;
}

interface ChipProps {
  /** The chip's text; also names its remove button ("Remove Red"). */
  children: string;
  /** Shows a remove button, e.g. to drop an active filter. */
  onRemove?: () => void;
  className?: string;
}

/** A compact item such as an active filter, optionally removable. */
export function Chip({ children, onRemove, className }: ChipProps) {
  return (
    <span className={['chip', className].filter(Boolean).join(' ')}>
      <span className="chip__label">{children}</span>
      {onRemove && <IconButton className="chip__remove" label={`Remove ${children}`} icon="×" onPress={onRemove} />}
    </span>
  );
}
