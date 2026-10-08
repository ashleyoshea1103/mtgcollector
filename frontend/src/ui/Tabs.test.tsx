import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, Tabs } from './Tabs';

const views = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
] as const;

describe('SegmentedControl', () => {
  it('is a named group showing which option is chosen, and reports a new choice', async () => {
    const onChange = vi.fn<(v: 'grid' | 'list') => void>();
    render(<SegmentedControl label="View" options={views} value="grid" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'List' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it("always keeps one chosen: pressing the chosen one doesn't clear it", async () => {
    const onChange = vi.fn<(v: 'grid' | 'list') => void>();
    render(<SegmentedControl label="View" options={views} value="grid" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves between options with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<SegmentedControl label="View" options={views} value="grid" onChange={() => {}} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus();
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'cards', label: 'Cards', content: <p>All cards</p> },
    { id: 'stats', label: 'Stats', content: <p>Totals</p> },
  ] as const;

  it('shows the first tab, and another when it is picked', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Collection" tabs={tabs} />);
    expect(screen.getByRole('tablist', { name: 'Collection' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Cards' })).toHaveTextContent('All cards');

    await user.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(screen.getByRole('tabpanel', { name: 'Stats' })).toHaveTextContent('Totals');
    expect(screen.queryByText('All cards')).not.toBeInTheDocument();
  });

  it('switches tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Collection" tabs={tabs} />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Totals');
  });

  it('can be controlled by its parent', async () => {
    const onSelectedChange = vi.fn<(id: 'cards' | 'stats') => void>();
    render(<Tabs label="Collection" tabs={tabs} selected="stats" onSelectedChange={onSelectedChange} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Totals');
    await userEvent.click(screen.getByRole('tab', { name: 'Cards' }));
    expect(onSelectedChange).toHaveBeenCalledWith('cards');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Totals');
  });
});
