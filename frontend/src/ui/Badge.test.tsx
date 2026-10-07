import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Chip } from './Badge';

describe('Badge', () => {
  it('shows its content, classed by tone', () => {
    render(
      <Badge tone="accent" className="extra">
        4×
      </Badge>,
    );
    expect(screen.getByText('4×')).toHaveClass('badge', 'badge--accent', 'extra');
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>Foil</Badge>);
    expect(screen.getByText('Foil')).toHaveClass('badge--neutral');
  });
});

describe('Chip', () => {
  it('has a remove button named after it when removable', async () => {
    const onRemove = vi.fn<() => void>();
    render(<Chip onRemove={onRemove}>Red</Chip>);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Red' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('has no button when it cannot be removed', () => {
    render(<Chip>Red</Chip>);
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
