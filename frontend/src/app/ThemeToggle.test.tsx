import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('starts dark, and switches the page to light and back, remembering the choice', async () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole('button', { name: 'Light theme' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('mtgcollector-theme')).toBe('light');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('mtgcollector-theme')).toBe('dark');
  });

  it('starts from the theme chosen before', () => {
    localStorage.setItem('mtgcollector-theme', 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true');
  });
});
