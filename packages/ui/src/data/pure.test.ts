import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The data core is pure: its modules import only one another — no React,
 * no DOM, no i18n, no package. That is what lets the automation engine,
 * which runs on the server, import it under its own purity guard.
 */
const DATA = import.meta.dirname;

const modules = readdirSync(DATA).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
);

describe('the data core', () => {
  it('holds the modules the engine may import', () => {
    expect(modules).toEqual(
      expect.arrayContaining([
        'infer-schema.ts',
        'json-pointer.ts',
        'stable-stringify.ts',
        'value-diff.ts',
        'value-summary.ts',
      ]),
    );
  });

  it.each(modules)('%s imports only other data modules', (file) => {
    const source = readFileSync(path.join(DATA, file), 'utf8');
    const specifiers = [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g,
      ),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1] ?? '');
    for (const specifier of specifiers) {
      expect(specifier, `${file} imports ${specifier}`).toMatch(
        /^\.\/[a-z-]+$/,
      );
    }
  });
});
