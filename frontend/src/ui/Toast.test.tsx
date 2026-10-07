import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Toaster } from './Toast';
import { createToastQueue, toast } from './toastQueue';

describe('toast and Toaster', () => {
  it('shows a toast with its title and description in a named region', () => {
    const queue = createToastQueue();
    render(<Toaster queue={queue} />);
    act(() => {
      toast({ title: 'Added 4 × Lightning Bolt', description: 'to Trade binder', tone: 'success' }, { queue });
    });
    const region = screen.getByRole('region', { name: /notification/i });
    const shown = within(region).getByRole('alertdialog');
    expect(shown).toHaveTextContent('Added 4 × Lightning Bolt');
    expect(shown).toHaveTextContent('to Trade binder');
    expect(shown).toHaveClass('toast--success');
  });

  it('can be dismissed', async () => {
    const queue = createToastQueue();
    render(<Toaster queue={queue} />);
    act(() => {
      toast({ title: 'Saved' }, { queue });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(queue.visibleToasts).toHaveLength(0);
  });

  it('gives toasts at least five seconds, and keeps errors until dismissed', () => {
    const queue = createToastQueue();
    toast({ title: 'Quick' }, { queue, timeout: 1000 });
    toast({ title: 'Default' }, { queue });
    toast({ title: 'Failed', tone: 'error' }, { queue, timeout: 8000 });
    expect(Object.fromEntries(queue.visibleToasts.map((t) => [t.content.title, t.timeout]))).toEqual({
      Quick: 5000,
      Default: 5000,
      Failed: undefined,
    });
  });

  it('shows at most three at once', () => {
    const queue = createToastQueue();
    for (let i = 0; i < 5; i++) toast({ title: `T${i}` }, { queue });
    expect(queue.visibleToasts).toHaveLength(3);
  });
});
