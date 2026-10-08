import type { ReactElement, ReactNode } from 'react';
import { Dialog as AriaDialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

interface DialogProps {
  title: ReactNode;
  /** The content; given a `close` function for buttons such as Cancel and Save. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** A Button that opens the dialog. Leave it out and use isOpen to open it from elsewhere. */
  trigger?: ReactElement;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * "alertdialog" for confirmations that need an answer (e.g. deleting a group): it can't
   * be dismissed by clicking outside.
   */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

/**
 * A modal dialog. Focus moves into it and stays there until it closes, then returns to
 * what opened it; Escape closes it, and the page behind is hidden from screen readers.
 */
export function Dialog({ title, children, trigger, isOpen, onOpenChange, role = 'dialog', className }: DialogProps) {
  const modal = (
    <ModalOverlay className="dialog-overlay" isDismissable={role === 'dialog'} isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal className="dialog-modal">
        <AriaDialog className={['dialog', className].filter(Boolean).join(' ')} role={role}>
          {({ close }) => (
            <>
              <Heading slot="title" className="dialog__title">
                {title}
              </Heading>
              {typeof children === 'function' ? children(close) : children}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
  if (!trigger) return modal;
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      {modal}
    </DialogTrigger>
  );
}
