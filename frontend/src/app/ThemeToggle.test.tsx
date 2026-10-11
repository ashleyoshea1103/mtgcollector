import { act, render, screen } from '@testing-library/react';
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

  it('follows a change made in another tab', () => {
    const { unmount } = render(<ThemeToggle />);
    const otherTab = (value: string | null) =>
      act(() => {
        if (value === null) localStorage.removeItem('mtgcollector-theme');
        else localStorage.setItem('mtgcollector-theme', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'mtgcollector-theme', newValue: value }));
      });

    otherTab('light');
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
    otherTab(null);
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.dataset.theme).toBeUndefined();

    // Once it's gone, other tabs' changes no longer reach this page.
    unmount();
    otherTab('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('starts from the theme the page is in, even if it could not be stored', () => {
    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true');
  });
});
