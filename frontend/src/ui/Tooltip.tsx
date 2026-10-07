import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Tooltip as AriaTooltip, TooltipTrigger, TooltipTriggerStateContext, type Placement } from 'react-aria-components';
import { VisuallyHidden } from './VisuallyHidden';

interface TooltipProps {
  /** What the tooltip says. */
  content: ReactNode;
  /** One focusable element from src/ui (Button, IconButton…): the tooltip opens on its hover and keyboard focus. */
  children: ReactElement;
  placement?: Placement;
  /** Milliseconds of hover before it opens. Keyboard focus opens it at once. */
  delay?: number;
}

/** A tooltip on an interactive element, opened by hover or keyboard focus and closed by Escape. */
export function Tooltip({ content, children, placement = 'top', delay = 600 }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay}>
      {children}
      <AriaTooltip className="tooltip" placement={placement} offset={6}>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

interface TooltipTextProps {
  /** The full form, e.g. "Near Mint" for "NM". */
  tooltip: string;
  /** The short form that's shown. */
  children: ReactNode;
  /** "abbr" for abbreviations and codes. */
  as?: 'span' | 'abbr';
  className?: string;
  /**
   * Whether screen readers should read the tooltip in place of the short form (the default).
   * Set false when the full form is already in the text nearby, or a parent supplies the
   * label: the element is then hidden from screen readers altogether.
   */
  announce?: boolean;
}

/**
 * Short text with its full form: screen readers read the full form, and hovering with a
 * mouse shows it as a tooltip. It replaces title=, which keyboard and touch users never
 * see and screen readers read inconsistently.
 *
 * The text isn't made focusable (a table of conditions and codes would become a long run of
 * tab stops), so keyboard users rely on the announced full form instead.
 */
export function TooltipText({ tooltip, children, as: Tag = 'span', className, announce = true }: TooltipTextProps) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tag
        ref={ref as never}
        className={className}
        data-tooltip={tooltip}
        aria-hidden
        onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        {children}
      </Tag>
      {announce && <VisuallyHidden>{tooltip}</VisuallyHidden>}
      {open && (
        // react-aria-components 1.21.1 reads a standalone Tooltip's state from this context
        // even when isOpen is passed, and crashes without it, so the state goes in here.
        <TooltipTriggerStateContext value={{ isOpen: true, shouldSkipAnimation: true, open() {}, close: () => setOpen(false) }}>
          <AriaTooltip className="tooltip" triggerRef={ref} placement="top" offset={6}>
            {tooltip}
          </AriaTooltip>
        </TooltipTriggerStateContext>
      )}
    </>
  );
}
