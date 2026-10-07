import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Field, NumberInput, SearchInput, Select, TextInput } from './Field';

describe('Field', () => {
  it('names its control by the label', () => {
    render(
      <>
        <Field label="Name">
          <TextInput defaultValue="" />
        </Field>
        <Field label="Quantity">
          <NumberInput defaultValue="1" min={1} max={999} />
        </Field>
        <Field label="Finish">
          <Select options={[{ value: 'foil', label: 'Foil' }]} value="foil" onChange={() => {}} />
        </Field>
        <Field label="Search">
          <SearchInput onSearch={() => {}} />
        </Field>
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveAttribute('max', '999');
    expect(screen.getByRole('combobox', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  });

  it('reads help and errors with the control, and marks it invalid only with an error', () => {
    const { rerender } = render(
      <Field label="Name" description="As on the box">
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('As on the box');
    expect(input).not.toHaveAttribute('aria-invalid');

    rerender(
      <Field label="Name" description="As on the box" error="Required">
        <TextInput />
      </Field>,
    );
    expect(input).toHaveAccessibleDescription('As on the box Required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('gives each field its own ids', () => {
    render(
      <>
        <Field label="A" description="a">
          <TextInput />
        </Field>
        <Field label="B" description="b">
          <TextInput />
        </Field>
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'A' })).toHaveAccessibleDescription('a');
    expect(screen.getByRole('textbox', { name: 'B' })).toHaveAccessibleDescription('b');
  });
});

describe('Select', () => {
  it('lists its options and reports the chosen value', async () => {
    const onChange = vi.fn<(v: 'a' | 'b') => void>();
    render(
      <Field label="Pick">
        <Select
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ]}
          value="a"
          onChange={onChange}
        />
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Pick' });
    expect([...select.querySelectorAll('option')].map((o) => [o.value, o.textContent])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ]);
    await userEvent.selectOptions(select, 'Beta');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('SearchInput', () => {
  // shouldAdvanceTime: Testing Library waits on real timers internally and would hang otherwise.
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());
  const setup = (delay?: number) => {
    const onSearch = vi.fn<(q: string) => void>();
    const user = userEvent.setup({ delay: 50, advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(
      <Field label="Search cards">
        <SearchInput onSearch={onSearch} delay={delay} />
      </Field>,
    );
    return { onSearch, user, box: screen.getByRole('searchbox', { name: 'Search cards' }) };
  };

  it('reports once typing pauses, not on every key', async () => {
    const { onSearch, user, box } = setup(300);
    await user.type(box, 'bolt');
    expect(onSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('bolt');
  });

  it('reports at once on Enter, and not again when the pause ends', async () => {
    const { onSearch, user, box } = setup(300);
    await user.type(box, 'elves{Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('elves');
    act(() => vi.advanceTimersByTime(1000));
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('empties on Escape or the clear button, reporting an empty query', async () => {
    const { onSearch, user, box } = setup(300);
    await user.type(box, 'ice{Enter}');
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(onSearch).toHaveBeenLastCalledWith('');

    await user.type(box, 'fire{Enter}');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(box).toHaveValue('');
    expect(onSearch).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(onSearch.mock.calls).toEqual([['ice'], [''], ['fire'], ['']]);
  });

  it("doesn't report the starting text on mount", () => {
    const onSearch = vi.fn<(q: string) => void>();
    render(<SearchInput aria-label="Search" defaultValue="bolt" onSearch={onSearch} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('bolt');
  });
});
