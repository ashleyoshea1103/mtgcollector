import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Tooltip, TooltipText } from './Tooltip';

describe('TooltipText', () => {
  it('shows the short form, but screen readers read the full form', () => {
    const { container } = render(
      <p>
        Condition:{' '}
        <TooltipText as="abbr" tooltip="Near Mint">
          NM
        </TooltipText>
      </p>,
    );
    const abbr = container.querySelector('abbr')!;
    expect(abbr).toHaveTextContent(/^NM$/);
    expect(abbr).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Near Mint')).toHaveClass('visually-hidden');
    // It replaces title=, which would make some screen readers read both.
    expect(abbr).not.toHaveAttribute('title');
  });

  it('shows the full form as a tooltip while a mouse hovers over it', async () => {
    const user = userEvent.setup();
    render(<TooltipText tooltip="No price available">—</TooltipText>);
    await user.hover(screen.getByText('—'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('No price available');
    await user.unhover(screen.getByText('—'));
    await waitForElementToBeRemoved(() => screen.queryByRole('tooltip'));
  });

  it('stays open while the pointer moves onto it', async () => {
    const user = userEvent.setup();
    render(<TooltipText tooltip="No price available">—</TooltipText>);
    await user.hover(screen.getByText('—'));
    await user.unhover(screen.getByText('—'));
    await user.hover(screen.getByRole('tooltip'));
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.unhover(screen.getByRole('tooltip'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('closes on Escape without the pointer moving', async () => {
    const user = userEvent.setup();
    render(<TooltipText tooltip="No price available">—</TooltipText>);
    await user.hover(screen.getByText('—'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it("doesn't open for a touch, which would leave it stuck open", () => {
    render(<TooltipText tooltip="German">DE</TooltipText>);
    fireEvent.pointerEnter(screen.getByText('DE'), { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('is hidden from screen readers entirely when it is not to be announced', () => {
    render(
      <TooltipText tooltip="Modern Horizons 2" announce={false}>
        MH2
      </TooltipText>,
    );
    expect(screen.getByText('MH2')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Modern Horizons 2')).not.toBeInTheDocument();
  });

  it('records its full form for tests and tools to find it by', () => {
    render(<TooltipText tooltip="Mythic rare">M</TooltipText>);
    expect(screen.getByText('M')).toHaveAttribute('data-tooltip', 'Mythic rare');
  });
});

describe('Tooltip', () => {
  it('opens on hover after a delay and on keyboard focus at once', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Sort by price" delay={0}>
        <Button>Sort</Button>
      </Tooltip>,
    );
    // React Aria only opens tooltips on hover once the last input was a pointer (an earlier
    // test pressed keys), so click elsewhere first, as a mouse user would have.
    await user.click(document.body);
    await user.hover(screen.getByRole('button', { name: 'Sort' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort by price');
    await user.unhover(screen.getByRole('button', { name: 'Sort' }));
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort by price');
  });

  it('describes its trigger while open', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Sort by price">
        <Button>Sort</Button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sort' })).toHaveAccessibleDescription('Sort by price');
  });
});
