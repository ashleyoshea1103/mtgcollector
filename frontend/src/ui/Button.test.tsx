import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton, ToggleButton } from './Button';

describe('Button', () => {
  it('is a button named by its text, classed by variant, that reports presses', async () => {
    const onPress = vi.fn<() => void>();
    render(
      <Button variant="danger" onPress={onPress}>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('button', 'button--danger');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("doesn't submit the form it's in unless it's a submit button", async () => {
    const onSubmit = vi.fn<(e: React.FormEvent) => void>((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('while busy, ignores presses and form submits but keeps focus', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn<() => void>();
    const onSubmit = vi.fn<(e: React.FormEvent) => void>((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy onPress={onPress}>
          Saving…
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('button--busy');
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('when disabled, ignores presses', async () => {
    const onPress = vi.fn<() => void>();
    render(
      <Button isDisabled onPress={onPress}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is named by its label, hides the icon from screen readers, and reports presses', async () => {
    const onPress = vi.fn<() => void>();
    render(<IconButton label="Remove" icon="×" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Remove' });
    expect(button.querySelector('[aria-hidden]')).toHaveTextContent('×');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('shows its label as a tooltip on keyboard focus, and Escape hides it', async () => {
    const user = userEvent.setup();
    render(<IconButton label="Remove" icon="×" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Remove');
    // The tooltip repeats the name, so it isn't read again as the description.
    expect(screen.getByRole('button', { name: 'Remove' })).not.toHaveAccessibleDescription();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('ToggleButton', () => {
  it('is announced as pressed while selected and reports presses', async () => {
    const onPress = vi.fn<() => void>();
    const { rerender } = render(
      <ToggleButton selected={false} onPress={onPress}>
        Foil
      </ToggleButton>,
    );
    const button = screen.getByRole('button', { name: 'Foil' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-pressed', 'false'); // the parent decides
    rerender(
      <ToggleButton selected onPress={onPress}>
        Foil
      </ToggleButton>,
    );
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
