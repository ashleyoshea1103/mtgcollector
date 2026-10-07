import { createContext, useContext, useEffect, useEffectEvent, useId, useRef, useState, type AriaAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

interface FieldControl {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

interface FieldProps {
  label: ReactNode;
  /** Help shown under the control and read with it. */
  description?: ReactNode;
  /** An error shown under the control; marks the control invalid and is read with it. */
  error?: ReactNode;
  className?: string;
  /** One control: TextInput, NumberInput, Select or SearchInput. */
  children: ReactNode;
}

/**
 * A labelled form control, with optional help and error text. The control inside picks up
 * its id, description and invalid state from the field, so the label always names it.
 */
export function Field({ label, description, error, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', error ? 'field--invalid' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <FieldContext value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext>
      {description && (
        <p className="field__description" id={descriptionId}>
          {description}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface ControlWiring {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
}

/**
 * A control's id and ARIA wiring: the caller's own, merged with its Field's. Inside a Field
 * the field's id wins (its label points at it); descriptions from both are read.
 */
function useFieldControl(own: ControlWiring): ControlWiring {
  const field = useContext(FieldContext);
  if (!field) return { id: own.id, 'aria-describedby': own['aria-describedby'], 'aria-invalid': own['aria-invalid'] };
  return {
    id: field.id,
    'aria-describedby': [own['aria-describedby'], field.describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': own['aria-invalid'] ?? (field.invalid || undefined),
  };
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** A single-line text input. */
export function TextInput({ className, ...rest }: InputProps) {
  const control = useFieldControl(rest);
  return <input {...rest} {...control} type="text" className={['text-input', className].filter(Boolean).join(' ')} />;
}

/**
 * A number input: the browser's own spinbutton, so arrow keys, min and max work as
 * screen-reader users expect. The value stays a string so it can be cleared and retyped;
 * parse it on submit.
 */
export function NumberInput({ className, ...rest }: InputProps) {
  const control = useFieldControl(rest);
  return (
    <input {...rest} {...control} type="number" inputMode="numeric" className={['number-input', className].filter(Boolean).join(' ')} />
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> {
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A choice from a list: the browser's own select, which every platform makes accessible
 * (and shows as its native picker on phones).
 */
export function Select<T extends string>({ options, value, onChange, className, ...rest }: SelectProps<T>) {
  const control = useFieldControl(rest);
  return (
    <select
      {...rest}
      {...control}
      className={['select', className].filter(Boolean).join(' ')}
      value={value}
      // Only the options' own values can be chosen.
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface SearchInputProps extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange'> {
  /** The starting text; the input keeps its own text after that. */
  defaultValue?: string;
  /** Called once typing has paused for `delay` ms, at once on Enter, and with '' when cleared. */
  onSearch: (query: string) => void;
  delay?: number;
}

/** A search box that reports what was typed once the typing pauses. Escape or the clear button empties it. */
export function SearchInput({ defaultValue = '', onSearch, delay = 300, className, onKeyDown, ...rest }: SearchInputProps) {
  const [text, setText] = useState(defaultValue);
  // The last query reported, so a pause after Enter or a clear doesn't report it again.
  const reported = useRef(defaultValue);
  const control = useFieldControl(rest);

  const report = (query: string) => {
    if (query === reported.current) return;
    reported.current = query;
    onSearch(query);
  };
  const reportLater = useEffectEvent(report);
  useEffect(() => {
    const timer = setTimeout(() => reportLater(text), delay);
    return () => clearTimeout(timer);
  }, [text, delay]);

  const clear = () => {
    setText('');
    report('');
  };

  return (
    <span className={['search-input', className].filter(Boolean).join(' ')}>
      <input
        {...rest}
        {...control}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === 'Enter') report(text);
          if (e.key === 'Escape' && text !== '') {
            // The browser would clear it too, without telling us; and an enclosing dialog,
            // popover or menu would close. Only an Escape in an empty box goes further.
            e.preventDefault();
            e.stopPropagation();
            clear();
          }
        }}
      />
      {text !== '' && (
        // A plain button so it stays out of the tab order of the form around it: Escape does the same.
        <button type="button" className="search-input__clear" aria-label="Clear search" tabIndex={-1} onClick={clear}>
          <span aria-hidden>×</span>
        </button>
      )}
    </span>
  );
}
