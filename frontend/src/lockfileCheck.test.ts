import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/check-lockfile.mjs runs before anything is installed (in verify, CI and the pre-push
// hook). These run it on small lockfiles. (Tests live here because verify only runs
// frontend/src/**/*.test.ts.)
const script = fileURLToPath(new URL('../../scripts/check-lockfile.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'lockfile-check-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hash = 'sha512-' + 'A'.repeat(86) + '==';
const fromRegistry = (name: string, extra: object = {}) => ({
  version: '1.0.0',
  resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-1.0.0.tgz`,
  integrity: hash,
  ...extra,
});
const bundled = { version: '2.0.0', inBundle: true };

let n = 0;
function check(packages: Record<string, object>) {
  const file = join(dir, `lock-${n++}.json`);
  writeFileSync(file, JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'app' }, ...packages } }));
  const run = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  return { ok: run.status === 0, output: run.stdout + run.stderr };
}

describe('check-lockfile.mjs', () => {
  it('accepts packages from the registry with sha512 hashes', () => {
    expect(check({ 'node_modules/a': fromRegistry('a'), 'node_modules/@s/b': fromRegistry('@s/b') }).ok).toBe(true);
  });

  it('rejects a package from elsewhere or without a sha512 hash', () => {
    expect(check({ 'node_modules/a': fromRegistry('a', { resolved: 'https://evil.example/a.tgz' }) }).ok).toBe(false);
    expect(check({ 'node_modules/a': fromRegistry('a', { integrity: 'sha1-abc' }) }).ok).toBe(false);
    expect(check({ 'node_modules/a': { version: '1.0.0' } }).ok).toBe(false);
  });

  // As Tailwind's oxide-wasm32-wasi ships its runtime: the bundled packages have no URL or
  // hash, and come inside the bundler's checked download.
  it('accepts packages bundled inside a checked package that declares them', () => {
    const result = check({
      'node_modules/w': fromRegistry('w', { bundleDependencies: ['x', 'y'] }),
      'node_modules/w/node_modules/x': bundled,
      'node_modules/w/node_modules/y': bundled,
      'node_modules/w/node_modules/x/node_modules/z': bundled,
    });
    expect(result.output).toContain('3 of them bundled');
    expect(result.ok).toBe(true);
  });

  it('rejects a bundled package whose bundler fails the check', () => {
    const result = check({
      'node_modules/w': fromRegistry('w', { bundleDependencies: ['x'], resolved: 'https://evil.example/w.tgz' }),
      'node_modules/w/node_modules/x': bundled,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('bundled in node_modules/w, which fails this check');
  });

  it('rejects a bundled package in a bundler that declares no bundled dependencies', () => {
    const result = check({ 'node_modules/w': fromRegistry('w'), 'node_modules/w/node_modules/x': bundled });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('declares no bundled dependencies');
  });

  // The project's own node_modules aren't a checked download, so "bundled" there proves nothing.
  it('rejects a package marked bundled at the top level', () => {
    const result = check({ 'node_modules/x': bundled });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('not inside a package from the registry');
  });

  it('still checks a URL or hash that a bundled package does give', () => {
    expect(
      check({
        'node_modules/w': fromRegistry('w', { bundleDependencies: ['x'] }),
        'node_modules/w/node_modules/x': { ...bundled, resolved: 'https://evil.example/x.tgz' },
      }).ok,
    ).toBe(false);
  });
});
