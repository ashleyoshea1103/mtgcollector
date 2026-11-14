import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LazyToaster } from './LazyToaster';
import { toast, toasts } from './toastQueue';

describe('LazyToaster', () => {
  it('loads the Toaster and shows toasts queued before it arrived', async () => {
    act(() => {
      toast({ title: 'Queued early' });
    });
    render(<LazyToaster />);
    expect(await screen.findByText('Queued early')).toBeInTheDocument();
    act(() => toasts.clear());
  });
});
