import type { CSSProperties, ElementType, ReactNode } from 'react';

/** A step on the spacing scale in src/styles/tokens.css (--spacing-0 … --spacing-7). */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface LayoutProps {
  /** The element to render, e.g. 'ul' for a list. */
  as?: ElementType;
  gap?: Space;
  className?: string;
  children: ReactNode;
}

const space = (step: Space) => `var(--spacing-${step})`;
const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ');

/** Children one above the other, evenly spaced. */
export function Stack({ as: Tag = 'div', gap = 3, className, children }: LayoutProps) {
  return (
    <Tag className={join('stack', className)} style={{ '--layout-gap': space(gap) } as CSSProperties}>
      {children}
    </Tag>
  );
}

interface ClusterProps extends LayoutProps {
  /** How items line up across the row. */
  justify?: 'start' | 'center' | 'end' | 'space-between';
}

/** Children side by side, wrapping onto new lines when they run out of room (buttons, badges, meta). */
export function Cluster({ as: Tag = 'div', gap = 2, justify = 'start', className, children }: ClusterProps) {
  return (
    <Tag className={join('cluster', className)} style={{ '--layout-gap': space(gap), '--cluster-justify': justify } as CSSProperties}>
      {children}
    </Tag>
  );
}

interface GridProps extends LayoutProps {
  /** Columns are as many as fit at this width, e.g. "180px". */
  minItemWidth: string;
}

/** Equal columns, as many as fit (card grids). */
export function Grid({ as: Tag = 'div', gap = 4, minItemWidth, className, children }: GridProps) {
  return (
    <Tag className={join('grid', className)} style={{ '--layout-gap': space(gap), '--grid-min': minItemWidth } as CSSProperties}>
      {children}
    </Tag>
  );
}
