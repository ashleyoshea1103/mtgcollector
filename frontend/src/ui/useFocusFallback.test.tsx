import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFocusFallback } from './useFocusFallback';

function List({ items }: { items: string[] }) {
  const keep = useFocusFallback<HTMLElement>((part) => part.querySelector('h2 button'), items);
  return (
    <section {...keep}>
      <h2>
        <button type="button">Red</button>
      </h2>
      {items.map((item) => (
        <button key={item} type="button">
          Remove {item}
        </button>
      ))}
    </section>
  );
}

describe('useFocusFallback', () => {
  it('moves focus to the fallback when the focused item goes', () => {
    const { rerender } = render(<List items={['Bolt', 'Ragavan']} />);
    screen.getByRole('button', { name: 'Remove Bolt' }).focus();
    rerender(<List items={['Ragavan']} />);
    expect(screen.getByRole('button', { name: 'Red' })).toHaveFocus();
  });

  it('leaves focus alone when the focused item stays', () => {
    const { rerender } = render(<List items={['Bolt', 'Ragavan']} />);
    screen.getByRole('button', { name: 'Remove Ragavan' }).focus();
    rerender(<List items={['Ragavan']} />);
    expect(screen.getByRole('button', { name: 'Remove Ragavan' })).toHaveFocus();
  });

  it('leaves focus alone when it is somewhere else now', () => {
    const { rerender } = render(
      <>
        <List items={['Bolt']} />
        <input aria-label="Search" />
      </>,
    );
    screen.getByRole('button', { name: 'Remove Bolt' }).focus();
    screen.getByRole('textbox').focus();
    rerender(
      <>
        <List items={[]} />
        <input aria-label="Search" />
      </>,
    );
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it("does nothing when focus was never in the part", () => {
    const { rerender } = render(<List items={['Bolt']} />);
    rerender(<List items={[]} />);
    expect(document.activeElement).toBe(document.body);
  });
});
