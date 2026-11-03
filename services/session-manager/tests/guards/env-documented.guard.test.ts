// Every setting the server reads from the environment is in `.env.example` and
// in the README's table of settings (AGENTS.md: an env var changes the docs,
// `.env.example` and the READMEs in the same change). The names are read from
// the server's own source, so a new setting cannot be forgotten.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

/** Not the server's settings: the environment it passes on to a child. */
const NOT_SETTINGS = new Set(['NO_COLOR']);

function sourcesOf(directory: string): string[] {
  const found: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (
        entry.name.endsWith('.ts') &&
        !/\.(test|camoufox\.test)\.ts$/.test(entry.name)
      ) {
        found.push(path);
      }
    }
  };
  visit(directory);
  return found;
}

/** `env.NAME` and `process.env.NAME` in the server's shipped code. */
function settingsRead(): string[] {
  const files = [
    ...sourcesOf(join(ROOT, 'backend')).filter(
      (path) => !relative(ROOT, path).startsWith('backend/testing/'),
    ),
    join(ROOT, 'server.ts'),
  ];
  const names = new Set<string>();
  for (const file of files) {
    for (const [, name = ''] of readFileSync(file, 'utf8').matchAll(
      /\benv\.([A-Z][A-Z0-9_]*)\b/g,
    )) {
      if (!NOT_SETTINGS.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

describe('the settings of the server', () => {
  const names = settingsRead();

  it('are found in its source', () => {
    expect(names).toEqual(
      expect.arrayContaining(['PORT', 'SESSION_MANAGER_DATA_DIR', 'DEBUG']),
    );
  });

  it.each(names)('%s is in .env.example', (name) => {
    expect(example).toMatch(new RegExp(`^(?:# )?${name}=`, 'm'));
  });

  it.each(names)("%s is in the README's table of settings", (name) => {
    expect(readme).toMatch(new RegExp(`^\\| \`${name}\` +\\|`, 'm'));
  });
});
