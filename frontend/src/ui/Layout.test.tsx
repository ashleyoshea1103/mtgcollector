import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cluster, Grid, Stack } from './Layout';
import { VisuallyHidden } from './VisuallyHidden';

describe('Stack, Cluster and Grid', () => {
  it('render the element asked for, with a gap from the spacing scale', () => {
    const { container } = render(
      <>
        <Stack as="ul" gap={5}>
          <li>a</li>
        </Stack>
        <Cluster gap={1} justify="space-between" className="meta">
          <span>b</span>
        </Cluster>
        <Grid as="section" minItemWidth="180px">
          <div>c</div>
        </Grid>
      </>,
    );
    const [stack, cluster, grid] = [...container.children] as HTMLElement[];
    expect(stack.tagName).toBe('UL');
    expect(stack).toHaveClass('stack');
    expect(stack.style.getPropertyValue('--layout-gap')).toBe('var(--space-5)');
    expect(screen.getByRole('listitem')).toHaveTextContent('a');

    expect(cluster.tagName).toBe('DIV');
    expect(cluster).toHaveClass('cluster', 'meta');
    expect(cluster.style.getPropertyValue('--layout-gap')).toBe('var(--space-1)');
    expect(cluster.style.getPropertyValue('--cluster-justify')).toBe('space-between');

    expect(grid.tagName).toBe('SECTION');
    expect(grid.style.getPropertyValue('--grid-min')).toBe('180px');
    expect(grid.style.getPropertyValue('--layout-gap')).toBe('var(--space-4)');
  });
});

describe('VisuallyHidden', () => {
  it('keeps its text in the document for screen readers', () => {
    render(
      <button type="button">
        <span aria-hidden>×</span>
        <VisuallyHidden>Close</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('Close')).toHaveClass('visually-hidden');
  });
});
