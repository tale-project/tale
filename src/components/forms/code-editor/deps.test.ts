import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The code editor shares CodeMirror with Milkdown (the message editor), so
 * the lockfile must hold one copy of `@codemirror/state` and
 * `@codemirror/view`: a second copy breaks the editor at runtime
 * ("Unrecognized extension value in extension set"). And the package must
 * not reach for the CodeMirror bundles that pull in what it does not need:
 * the `codemirror` meta package (a basic setup), `@codemirror/language-data`
 * (every language CodeMirror knows) and `@codemirror/lang-markdown` (whose
 * module imports the HTML and CSS languages; Markdown is built from
 * `@lezer/markdown` instead).
 */

const PACKAGE_ROOT = join(__dirname, '..', '..', '..', '..');
const LOCKFILE = join(PACKAGE_ROOT, '..', '..', 'bun.lock');

const FORBIDDEN = [
  'codemirror',
  '@codemirror/language-data',
  '@codemirror/lang-markdown',
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('CodeMirror dependencies', () => {
  it.each(['@codemirror/state', '@codemirror/view'])(
    'the lockfile resolves one copy of %s',
    (name) => {
      const lock = readFileSync(LOCKFILE, 'utf8');
      const escaped = name.replace('/', '\\/');
      const copies = lock.match(
        new RegExp(`^\\s*"(?:[^"]*/)?${escaped}": \\["${escaped}@`, 'gm'),
      );
      expect(copies).toHaveLength(1);
    },
  );

  it('never imports a CodeMirror bundle the editor does not need', () => {
    const offenders: string[] = [];
    for (const file of sources(join(PACKAGE_ROOT, 'src'))) {
      if (file === __filename) continue;
      const text = readFileSync(file, 'utf8');
      for (const name of FORBIDDEN) {
        if (new RegExp(`from '${name}'|import\\('${name}'\\)`).test(text)) {
          offenders.push(`${relative(PACKAGE_ROOT, file)} imports ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
