import { useEffect, useState } from 'react';
import { applyTheme, currentTheme, onThemeChanged, saveTheme, type Theme } from '../lib/theme';
import { ToggleButton } from '../ui';

/** Switches between the dark theme (the design) and a light one, remembered in this browser. */
export function ThemeToggle() {
  // The page's own: it's the same as the stored one, unless storing it failed.
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  // A change in another tab applies here too.
  useEffect(
    () =>
      onThemeChanged((next) => {
        applyTheme(next);
        setTheme(next);
      }),
    [],
  );

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  }

  return (
    <ToggleButton className="theme-toggle" selected={theme === 'light'} onPress={toggle}>
      {/* A sun; on a phone it's shown alone, and the words are kept for screen readers. */}
      <svg className="theme-toggle__icon" aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="9" cy="9" r="3.4" />
        <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
      </svg>
      <span className="theme-toggle__label">Light theme</span>
    </ToggleButton>
  );
}
