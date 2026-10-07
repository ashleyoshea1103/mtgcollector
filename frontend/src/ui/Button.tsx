import type { ReactNode } from 'react';
import { Button as AriaButton, ToggleButton as AriaToggleButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type SharedProps = Pick<AriaButtonProps, 'type' | 'onPress' | 'isDisabled' | 'slot' | 'form' | 'autoFocus' | 'aria-describedby'>;

export interface ButtonProps extends SharedProps {
  variant?: ButtonVariant;
  /**
   * Work started by this button is under way. The button ignores presses and tells screen
   * readers it's busy, but stays focusable so focus isn't lost. Show the progress in the
   * label too, e.g. "Adding…".
   */
  busy?: boolean;
  className?: string;
  children: ReactNode;
}

const classes = (base: string, variant: ButtonVariant, busy: boolean, extra = '') =>
  [base, `${base}--${variant}`, busy && `${base}--busy`, extra].filter(Boolean).join(' ');

/** A button. Press handling (mouse, touch, keyboard) and disabled and busy states come from React Aria. */
export function Button({ variant = 'secondary', busy = false, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <AriaButton {...rest} type={type} isPending={busy} className={classes('button', variant, busy, className)}>
      {children}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  /** What the button does; it's the button's accessible name and its tooltip. */
  label: string;
  /** The icon (a glyph for now); hidden from screen readers, which read the label instead. */
  icon: ReactNode;
}

/** A button showing only an icon, named by its label, which also shows as a tooltip. */
export function IconButton({ label, icon, variant = 'ghost', busy = false, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <Tooltip content={label}>
      <AriaButton {...rest} type={type} aria-label={label} isPending={busy} className={classes('icon-button', variant, busy, className)}>
        <span aria-hidden>{icon}</span>
      </AriaButton>
    </Tooltip>
  );
}

export interface ToggleButtonProps extends Pick<AriaButtonProps, 'onPress' | 'isDisabled'> {
  /** On or off; announced as pressed or not. */
  selected: boolean;
  className?: string;
  children: ReactNode;
}

/** A button that stays pressed while its option is selected. */
export function ToggleButton({ selected, className, children, ...rest }: ToggleButtonProps) {
  return (
    <AriaToggleButton {...rest} isSelected={selected} className={['toggle-button', className].filter(Boolean).join(' ')}>
      {children}
    </AriaToggleButton>
  );
}
