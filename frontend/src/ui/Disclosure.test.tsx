import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Disclosure } from './Disclosure';

const toggle = () => screen.getByRole('button', { name: 'Details' });

describe('Disclosure', () => {
  it('puts its toggle in a heading at the given level', () => {
    render(
      <Disclosure title="Details" headingLevel={3}>
        Body
      </Disclosure>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Details' })).toContainElement(toggle());
  });

  it('opens and closes, rendering its content only while open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <Disclosure title="Details" onOpenChange={onOpenChange}>
        Body
      </Disclosure>,
    );
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Body')).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    await user.keyboard('{Enter}');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('can start closed', () => {
    render(
      <Disclosure title="Details" defaultOpen={false}>
        Body
      </Disclosure>,
    );
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('follows a controlled state, only reporting clicks', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { rerender } = render(
      <Disclosure title="Details" open={false} onOpenChange={onOpenChange}>
        Body
      </Disclosure>,
    );
    await userEvent.click(toggle());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <Disclosure title="Details" open onOpenChange={onOpenChange}>
        Body
      </Disclosure>,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledOnce();
  });

  it('stays where it was when the parent stops controlling it', () => {
    // Starts open, is closed by the parent, then released: it must stay closed, not fall
    // back to how it started.
    const { rerender } = render(
      <Disclosure title="Details" open>
        Body
      </Disclosure>,
    );
    rerender(
      <Disclosure title="Details" open={false}>
        Body
      </Disclosure>,
    );
    rerender(<Disclosure title="Details">Body</Disclosure>);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('labels its panel with the toggle', () => {
    render(<Disclosure title="Details">Body</Disclosure>);
    expect(screen.getByRole('group', { name: 'Details' })).toHaveTextContent('Body');
  });
});
