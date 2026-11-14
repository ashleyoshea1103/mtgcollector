import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs as AriaTabs, ToggleButton, ToggleButtonGroup } from 'react-aria-components';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Names the group for screen readers, e.g. "View". */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A row of buttons picking one of a few options (grid or list view). Arrow keys move
 * between them; one is always chosen. For switching between whole panels, use Tabs.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      className={['segmented-control', className].filter(Boolean).join(' ')}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      // Only the options' own values are keys here.
      onSelectionChange={(keys) => {
        const [next] = keys;
        if (next !== undefined && next !== value) onChange(next as T);
      }}
    >
      {options.map((o) => (
        <ToggleButton key={o.value} id={o.value} className="segmented-control__option">
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

interface TabsProps<T extends string> {
  /** Names the tab list for screen readers. */
  label: string;
  tabs: readonly TabItem<T>[];
  /** Controlled selection; leave out to start on the first tab. */
  selected?: T;
  onSelectedChange?: (id: T) => void;
  className?: string;
}

/** Panels of content, one shown at a time, picked from a list of tabs (arrow keys move between tabs). */
export function Tabs<T extends string>({ label, tabs, selected, onSelectedChange, className }: TabsProps<T>) {
  return (
    <AriaTabs
      className={['tabs', className].filter(Boolean).join(' ')}
      selectedKey={selected}
      onSelectionChange={onSelectedChange && ((key) => onSelectedChange(key as T))}
    >
      <TabList aria-label={label} className="tabs__list">
        {tabs.map((t) => (
          <Tab key={t.id} id={t.id} className="tabs__tab">
            {t.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((t) => (
        <TabPanel key={t.id} id={t.id} className="tabs__panel">
          {t.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
