import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';

interface LoadingProps {
  label?: string;
  /**
   * Announce it as it appears (the default). Turn off where many can appear at once, such as
   * one per collection group, so screen readers aren't flooded; the text is still readable.
   */
  live?: boolean;
  className?: string;
}

/** Says something is loading, politely announced to screen readers. */
export function Loading({ label = 'Loading…', live = true, className }: LoadingProps) {
  return (
    <p className={['loading', className].filter(Boolean).join(' ')} role={live ? 'status' : undefined}>
      {label}
    </p>
  );
}

interface SkeletonProps {
  /** How many placeholder lines. */
  lines?: number;
  /** A CSS width for each line, e.g. "12rem" or "60%". */
  width?: string;
  className?: string;
}

/**
 * Grey placeholder shapes where content will appear. Purely visual: pair it with a
 * Loading message (or aria-busy on the region) so screen readers hear what's happening.
 */
export function Skeleton({ lines = 1, width, className }: SkeletonProps) {
  return (
    <span className={['skeleton', className].filter(Boolean).join(' ')} aria-hidden style={width ? ({ '--skeleton-width': width } as CSSProperties) : undefined}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton__line" />
      ))}
    </span>
  );
}

interface ErrorStateProps {
  /** What went wrong, in the user's terms. */
  message: ReactNode;
  /** Shows a retry button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** Something failed to load or save: announced at once, with a way to try again. */
export function ErrorState({ message, onRetry, retryLabel = 'Try again', className }: ErrorStateProps) {
  return (
    <div className={['error-state', className].filter(Boolean).join(' ')} role="alert">
      <p className="error-state__message">{message}</p>
      {onRetry && <Button onPress={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

interface EmptyStateProps {
  title: ReactNode;
  /** More detail, e.g. how to add something. */
  children?: ReactNode;
  /** A next step, e.g. an "Add cards" button. */
  action?: ReactNode;
  className?: string;
}

/** A list or section with nothing in it yet, said plainly rather than left blank. */
export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
