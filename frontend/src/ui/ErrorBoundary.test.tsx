import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ErrorBoundary } from './ErrorBoundary';

let broken = true;
function Fragile({ name }: { name: string }) {
  if (broken) throw new Error(`internal detail about ${name}`);
  return <p>{name} is fine</p>;
}

const fallback = (reset: () => void) => (
  <div role="alert">
    Couldn't show this. <Button onPress={reset}>Try again</Button>
  </div>
);

describe('ErrorBoundary', () => {
  beforeEach(() => {
    broken = true;
    // React reports caught errors to the console; that's expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the fallback in place of what threw, and only there', () => {
    render(
      <>
        <p>Header</p>
        <ErrorBoundary fallback={fallback}>
          <Fragile name="Bolt" />
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't show this.");
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
  });

  it('renders the children while they work', () => {
    broken = false;
    render(
      <ErrorBoundary fallback={fallback}>
        <Fragile name="Bolt" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Bolt is fine')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tries the children again on reset', async () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <Fragile name="Bolt" />
      </ErrorBoundary>,
    );
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Bolt is fine')).toBeInTheDocument();
  });

  it('tries again when a reset key changes, and not otherwise', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKeys={['a']}>
        <Fragile name="Bolt" />
      </ErrorBoundary>,
    );
    broken = false;
    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={['a']}>
        <Fragile name="Bolt" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={['b']}>
        <Fragile name="Bolt" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Bolt is fine')).toBeInTheDocument();
  });
});
