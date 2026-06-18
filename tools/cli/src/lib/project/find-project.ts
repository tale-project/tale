import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { preconditionError } from '../../utils/fail';

export function findProject(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());

  while (true) {
    if (existsSync(join(dir, 'tale.json'))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Look one level *down* for a project. `tale init` scaffolds into a named
 * subdirectory, so a common mistake is running a command from the
 * parent — where the project is a child, not an ancestor (all {@link
 * findProject} walks). Returns the first child directory containing a
 * `tale.json`, or null.
 */
export function findChildProject(startDir?: string): string | null {
  const dir = resolve(startDir ?? process.cwd());
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const candidate = join(dir, name);
    try {
      if (
        statSync(candidate).isDirectory() &&
        existsSync(join(candidate, 'tale.json'))
      ) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function requireProject(startDir?: string): string {
  const dir = findProject(startDir);
  if (dir) return dir;

  // A common mistake is running from the parent of a `tale init` subdirectory —
  // point at the child rather than reporting a bare "not found".
  const child = findChildProject(startDir);
  if (child) {
    const rel = relative(resolve(startDir ?? process.cwd()), child);
    throw preconditionError(`No Tale project here — found one at ./${rel}.`, [
      `cd ${rel}`,
    ]);
  }
  throw preconditionError('No Tale project found.', [
    'tale init',
    'then run the command from the project directory',
  ]);
}
