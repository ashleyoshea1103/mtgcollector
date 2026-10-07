import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, Loading, Skeleton } from './Status';

describe('Loading', () => {
  it('is a status message, with a default label', () => {
    const { rerender } = render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    rerender(<Loading label="Loading cards…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading cards…');
  });

  it('can be quiet, where many could appear at once', () => {
    render(<Loading live={false} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('draws placeholder lines hidden from screen readers', () => {
    const { container } = render(<Skeleton lines={3} width="60%" />);
    const skeleton = container.firstElementChild as HTMLElement;
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton.querySelectorAll('.skeleton__line')).toHaveLength(3);
    expect(skeleton.style.getPropertyValue('--skeleton-width')).toBe('60%');
  });
});

describe('ErrorState', () => {
  it('is announced at once and offers a retry', async () => {
    const onRetry = vi.fn<() => void>();
    render(<ErrorState message="Couldn't load your collection." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your collection.");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no retry without a way to retry', () => {
    render(<ErrorState message="Not found." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('can name its retry', () => {
    render(<ErrorState message="Failed." onRetry={() => {}} retryLabel="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('shows its title, detail and next step', () => {
    render(
      <EmptyState title="No cards yet" action={<button type="button">Add cards</button>}>
        Search for a card to add it.
      </EmptyState>,
    );
    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(screen.getByText('Search for a card to add it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add cards' })).toBeInTheDocument();
  });
});
