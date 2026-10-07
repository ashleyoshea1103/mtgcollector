import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('opens from its trigger as a modal named by its title, and Escape returns focus', async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="Rename group" trigger={<Button>Rename</Button>}>
        <p>New name</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename group' });
    expect(dialog).toHaveTextContent('New name');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus());
  });

  it('gives its content a way to close it', async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="Rename group" trigger={<Button>Rename</Button>}>
        {(close) => <Button onPress={close}>Cancel</Button>}
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps focus inside while open', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Outside</Button>
        <Dialog title="Confirm" isOpen>
          <Button>One</Button>
          <Button>Two</Button>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('closes on a click outside, unless it is an alertdialog', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Dialog title="Details" trigger={<Button>Open</Button>}>
        Text
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(document.querySelector('.dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <Dialog title="Delete?" role="alertdialog" trigger={<Button>Open</Button>}>
        Text
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(document.querySelector('.dialog-overlay')!);
    expect(screen.getByRole('alertdialog', { name: 'Delete?' })).toBeInTheDocument();
  });

  it('can be opened and closed by its parent', async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { rerender } = render(
      <Dialog title="Delete group?" role="alertdialog" isOpen onOpenChange={onOpenChange}>
        Gone for good.
      </Dialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete group?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <Dialog title="Delete group?" role="alertdialog" isOpen={false} onOpenChange={onOpenChange}>
        Gone for good.
      </Dialog>,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
