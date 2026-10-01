// Paths for the tests. The tests run from dist/test/, compiled, so a path that
// starts at the repository root cannot be relative to the test file: look upward
// for package.json.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json not found');
    dir = parent;
  }
  return dir;
}

export const ROOT = findRoot();
export const PACKAGE_JSON = join(ROOT, 'package.json');
export const FIXTURE = join(ROOT, 'test', 'fixture.jsonl');
export const GOLDEN_SESSION = join(ROOT, 'test', 'golden', 'fixture.session.json');
export const GOLDEN_STEPS = join(ROOT, 'test', 'golden', 'fixture.steps.json');
/** The compiled CLI. The tests run after the build. */
export const BIN = join(ROOT, 'dist', 'bin', 'yast.js');
export const SRC_DIR = join(ROOT, 'src');

/** The version in package.json. */
export function packageVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('version' in pkg) || typeof pkg.version !== 'string') throw new Error('package.json has no version');
  return pkg.version;
}
