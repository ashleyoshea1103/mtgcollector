import type { ReactElement, ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  type Key,
  type Placement,
} from 'react-aria-components';

interface MenuProps {
  /** A Button that opens the menu, and names it: give it a specific name, e.g. aria-label "Actions for Lightning Bolt". */
  trigger: ReactElement;
  /** Called with the chosen item's id. */
  onAction: (id: Key) => void;
  /** MenuItems. */
  children: ReactNode;
  placement?: Placement;
}

/** A list of actions that opens from a button; arrow keys move through it and typing jumps to an item. */
export function Menu({ trigger, onAction, children, placement = 'bottom start' }: MenuProps) {
  return (
    <MenuTrigger>
      {trigger}
      <AriaPopover className="popover" placement={placement}>
        <AriaMenu className="menu" onAction={(id) => onAction(id)}>
          {children}
        </AriaMenu>
      </AriaPopover>
    </MenuTrigger>
  );
}

interface MenuItemProps {
  id: Key;
  children: string;
  isDisabled?: boolean;
  /** Marks a destructive action such as Delete. */
  danger?: boolean;
}

export function MenuItem({ id, children, isDisabled, danger = false }: MenuItemProps) {
  return (
    <AriaMenuItem id={id} isDisabled={isDisabled} textValue={children} className={`menu__item${danger ? ' menu__item--danger' : ''}`}>
      {children}
    </AriaMenuItem>
  );
}

interface PopoverProps {
  /** A Button that opens the popover. */
  trigger: ReactElement;
  /** A heading that also names the popover for screen readers. */
  title: ReactNode;
  children: ReactNode;
  placement?: Placement;
}

/**
 * Extra content (filters, details) next to the button that opened it. Unlike a Dialog the
 * page stays usable; clicking outside or Escape closes it and focus returns to the button.
 */
export function Popover({ trigger, title, children, placement = 'bottom start' }: PopoverProps) {
  return (
    <DialogTrigger>
      {trigger}
      <AriaPopover className="popover" placement={placement}>
        <AriaDialog className="popover__dialog">
          <Heading slot="title" className="popover__title">
            {title}
          </Heading>
          {children}
        </AriaDialog>
      </AriaPopover>
    </DialogTrigger>
  );
}
