import type { ReactNode } from 'react';
import { Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { useDisclosureState, type DisclosureStateOptions } from './useDisclosureState';

interface DisclosureProps extends DisclosureStateOptions {
  /** What the toggle button shows; it's also the heading's text. */
  title: ReactNode;
  /** The heading level that holds the toggle, so the section fits the page's outline. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  headingClassName?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /** Rendered only while open, so closed sections cost nothing. */
  children: ReactNode;
}

/** A section that opens and closes from a button in its heading. */
export function Disclosure({
  title,
  headingLevel = 2,
  className,
  headingClassName,
  triggerClassName,
  panelClassName,
  children,
  ...state
}: DisclosureProps) {
  const [isOpen, setOpen] = useDisclosureState(state);
  return (
    <AriaDisclosure className={['disclosure', className].filter(Boolean).join(' ')} isExpanded={isOpen} onExpandedChange={setOpen}>
      <Heading level={headingLevel} className={['disclosure__heading', headingClassName].filter(Boolean).join(' ')}>
        <AriaButton slot="trigger" className={['disclosure__trigger', triggerClassName].filter(Boolean).join(' ')}>
          {title}
        </AriaButton>
      </Heading>
      <DisclosurePanel className={['disclosure__panel', panelClassName].filter(Boolean).join(' ')}>{isOpen && children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
