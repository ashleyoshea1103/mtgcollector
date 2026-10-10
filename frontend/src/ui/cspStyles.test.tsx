import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

// The site's Content-Security-Policy (backend/internal/web/web.go) allows no inline styles but
// those it names by hash: the <style> elements React Aria adds. An upgrade that changes what
// they say would have them blocked, so these render the components that add them and check
// that each one's hash is in the policy.
// (From the frontend directory, where the tests run: under jsdom, import.meta.url isn't a file URL.)
const policySource = readFileSync(join(process.cwd(), '..', 'backend', 'internal', 'web', 'web.go'), 'utf8');

function addedStyles(): string[] {
  return [...document.head.querySelectorAll('style')].map((s) => s.textContent ?? '');
}

function cspHash(css: string): string {
  return `'sha256-${createHash('sha256').update(css).digest('base64')}'`;
}

async function openDialog() {
  const user = userEvent.setup();
  render(
    <Dialog title="Rename group" trigger={<Button>Rename</Button>}>
      <p>New name</p>
    </Dialog>,
  );
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
}

describe('the <style> elements React Aria adds', () => {
  // usePress adds its style everywhere but in tests (NODE_ENV=test), so these pretend not to be.
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('are allowed by the CSP, on any device', async () => {
    await openDialog();
    const styles = addedStyles();
    expect(styles.length).toBeGreaterThan(0); // usePress's, at least
    for (const css of styles) expect(policySource, css).toContain(cspHash(css));
  });

  it('are allowed by the CSP on an iPhone, where a dialog adds another', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('iPhone');
    const before = addedStyles().length;
    await openDialog();
    const styles = addedStyles();
    expect(styles.length).toBeGreaterThan(before);
    for (const css of styles) expect(policySource, css).toContain(cspHash(css));
  });
});
