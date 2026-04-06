import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

export function requireProject(startDir?: string): string {
  const dir = findProject(startDir);
  if (!dir) {
    throw new Error(
      'No Tale project found. Run "tale init" first, then run commands from the project directory.',
    );
  }
  return dir;
}
