// Checks that every package in a package-lock.json comes from the npm registry over
// HTTPS, with a sha512 integrity hash, under the name it's installed as.
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

const problems = [];
for (const [key, pkg] of Object.entries(lock.packages)) {
  if (key === '') continue; // the project itself
  const where = `${key}${pkg.version ? `@${pkg.version}` : ''}`;
  if (pkg.link) {
    problems.push(`${where}: linked package (not from the registry)`);
    continue;
  }
  // The name it's installed under: the part after the last node_modules/, e.g. "@scope/name".
  const installedAs = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const name = pkg.name ?? installedAs;
  // A package installed under another name is only legitimate as an npm alias
  // ("installedAs": "npm:name@…") declared by the package that depends on it.
  if (name !== installedAs && !declaresAlias(parentOf(key), installedAs, name)) {
    problems.push(`${where}: installed as "${installedAs}" but is "${name}", with no matching npm: alias`);
    continue;
  }
  const resolved = pkg.resolved ?? '';
  if (!resolved.startsWith(REGISTRY)) {
    problems.push(`${where}: resolved from ${resolved || '(nowhere)'}, not ${REGISTRY}`);
  } else if (!resolved.startsWith(`${REGISTRY}${name}/-/`)) {
    problems.push(`${where}: resolved URL ${resolved} is for a different package than "${name}"`);
  }
  if (!/^sha512-/.test(pkg.integrity ?? '')) {
    problems.push(`${where}: missing or weak integrity hash (${pkg.integrity ?? 'none'})`);
  }
}

if (problems.length > 0) {
  console.error(`${path}: ${problems.length} package(s) failed the lockfile check:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${path}: ${Object.keys(lock.packages).length - 1} packages, all from ${REGISTRY} with sha512 integrity`);
