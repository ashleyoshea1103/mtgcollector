// Checks that every package in a package-lock.json comes from the npm registry over
// HTTPS, with a sha512 integrity hash, under the name it's installed as.
//
// The one exception is a package bundled inside another ("inBundle": true): it isn't
// downloaded on its own, so it has no URL or hash of its own. It comes inside the package
// that bundles it, and is accepted only when that package declares bundled dependencies and
// passes every check here itself, so its sha512 covers what it bundles.
//
// Runs before `npm ci` and uses no dependencies, so a tampered lockfile is caught
// before anything from it is downloaded, and the checker can't be tampered with
// through the lockfile it checks.
//
// Usage: node scripts/check-lockfile.mjs frontend/package-lock.json
import { readFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org/';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/check-lockfile.mjs <package-lock.json>');
  process.exit(2);
}

const lock = JSON.parse(readFileSync(path, 'utf8'));
if (!lock.packages) {
  console.error(`${path}: expected lockfileVersion 2 or 3 (a "packages" map)`);
  process.exit(1);
}

/** The lockfile key of the package whose node_modules this key sits in ("" for the project). */
function parentOf(key) {
  const i = key.lastIndexOf('/node_modules/');
  return i === -1 ? '' : key.slice(0, i);
}

/** Whether that package declares `installedAs` as an alias for `name`, e.g. "npm:name@^1". */
function declaresAlias(parentKey, installedAs, name) {
  const parent = lock.packages[parentKey] ?? {};
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some((field) =>
    (parent[field]?.[installedAs] ?? '').startsWith(`npm:${name}@`),
  );
}

/** Whether a package declares bundled dependencies (npm accepts either spelling, or true for all). */
function bundles(pkg) {
  const list = pkg.bundleDependencies ?? pkg.bundledDependencies;
  return list === true || (Array.isArray(list) && list.length > 0);
}

/** What's wrong with the package at this lockfile key, if anything. */
function problemsOf(key) {
  const pkg = lock.packages[key];
  const where = `${key}${pkg.version ? `@${pkg.version}` : ''}`;
  if (pkg.link) return [`${where}: linked package (not from the registry)`];
  // The name it's installed under: the part after the last node_modules/, e.g. "@scope/name".
  const installedAs = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const name = pkg.name ?? installedAs;
  // A package installed under another name is only legitimate as an npm alias
  // ("installedAs": "npm:name@…") declared by the package that depends on it.
  if (name !== installedAs && !declaresAlias(parentOf(key), installedAs, name)) {
    return [`${where}: installed as "${installedAs}" but is "${name}", with no matching npm: alias`];
  }
  if (pkg.inBundle) {
    // Bundled packages come inside the nearest enclosing package that isn't itself bundled.
    let bundler = parentOf(key);
    while (bundler !== '' && lock.packages[bundler]?.inBundle) bundler = parentOf(bundler);
    const outer = lock.packages[bundler];
    // Not the project: what it bundles is whatever is in its own node_modules, unchecked.
    if (bundler === '' || !outer) return [`${where}: bundled, but not inside a package from the registry`];
    if (!bundles(outer)) return [`${where}: bundled, but ${bundler} declares no bundled dependencies`];
    if (problemsOf(bundler).length > 0) return [`${where}: bundled in ${bundler}, which fails this check`];
    // A bundled package that names a URL or hash anyway must pass the usual checks on them.
    if (pkg.resolved === undefined && pkg.integrity === undefined) return [];
  }
  const problems = [];
  const resolved = pkg.resolved ?? '';
  if (!resolved.startsWith(REGISTRY)) {
    problems.push(`${where}: resolved from ${resolved || '(nowhere)'}, not ${REGISTRY}`);
  } else if (!resolved.startsWith(`${REGISTRY}${name}/-/`)) {
    problems.push(`${where}: resolved URL ${resolved} is for a different package than "${name}"`);
  }
  if (!/^sha512-/.test(pkg.integrity ?? '')) {
    problems.push(`${where}: missing or weak integrity hash (${pkg.integrity ?? 'none'})`);
  }
  return problems;
}

const problems = [];
for (const key of Object.keys(lock.packages)) {
  if (key === '') continue; // the project itself
  problems.push(...problemsOf(key));
}

if (problems.length > 0) {
  console.error(`${path}: ${problems.length} package(s) failed the lockfile check:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const bundled = Object.values(lock.packages).filter((pkg) => pkg.inBundle).length;
console.log(
  `${path}: ${Object.keys(lock.packages).length - 1} packages, all from ${REGISTRY} with sha512 integrity` +
    (bundled > 0 ? ` (${bundled} of them bundled inside another, covered by its hash)` : ''),
);
