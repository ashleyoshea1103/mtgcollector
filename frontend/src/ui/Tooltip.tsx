import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
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

/** Milliseconds a hover tooltip lingers after the pointer leaves, so it can be moved onto. */
const CLOSE_DELAY = 150;

interface TooltipTextProps {
  /** The full form, e.g. "Near Mint" for "NM". */
  tooltip: string;
  /** The short form that's shown: text (or an image), nothing focusable, since it's hidden from screen readers. */
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
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // Closing waits a moment so the pointer can move onto the tooltip without it vanishing
  // (WCAG 1.4.13: content on hover stays while hovered).
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(closing.current);
    setOpen(true);
  };
  const hideSoon = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  // Escape dismisses it without moving the pointer (WCAG 1.4.13, content on hover).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return (
    <>
      <Tag
        ref={ref}
        className={className}
        data-tooltip={tooltip}
        aria-hidden
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={hideSoon}
      >
        {children}
      </Tag>
      {announce && <VisuallyHidden>{tooltip}</VisuallyHidden>}
      {open && (
        // react-aria-components 1.21.1 reads a standalone Tooltip's state from this context
        // even when isOpen is passed, and crashes without it, so the state goes in here.
        <TooltipTriggerStateContext value={{ isOpen: true, shouldSkipAnimation: true, open() {}, close: () => setOpen(false) }}>
          <AriaTooltip className="tooltip" triggerRef={ref} placement="top" offset={6} onPointerEnter={show} onPointerLeave={hideSoon}>
            {tooltip}
          </AriaTooltip>
        </TooltipTriggerStateContext>
      )}
    </>
  );
}
