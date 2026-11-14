import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Menu, MenuItem, Popover } from './Menu';

describe('Menu', () => {
  const setup = () => {
    const onAction = vi.fn<(id: React.Key) => void>();
    render(
      <Menu trigger={<Button>Actions</Button>} onAction={onAction}>
        <MenuItem id="edit">Edit</MenuItem>
        <MenuItem id="move" isDisabled>
          Move
        </MenuItem>
        <MenuItem id="delete" danger>
          Delete
        </MenuItem>
      </Menu>,
    );
    return { onAction, user: userEvent.setup() };
  };

  it('opens from its button and reports the chosen item', async () => {
    const { onAction, user } = setup();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Move', 'Delete']);
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('menu__item--danger');
    expect(menu).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onAction).toHaveBeenCalledWith('edit');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('works from the keyboard, skipping disabled items', async () => {
    const { onAction, user } = setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('closes on Escape, returning focus to its button', async () => {
    const { onAction, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus());
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('Popover', () => {
  it('opens next to its button as a dialog named by its title, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Filters</Button>} title="Filter cards">
        <p>Colours</p>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filter cards' })).toHaveTextContent('Colours');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus());
  });
});
