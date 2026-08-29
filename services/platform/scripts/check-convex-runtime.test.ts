// The Convex runtime guard.
//
// Every case builds a small tree on disk rather than mocking the filesystem,
// because what the guard has to get right IS the filesystem walk: which files
// count, which imports count, and how far it follows them.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  declaresUseNode,
  findOffenders,
  importsOf,
} from './check-convex-runtime';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree; `files` maps a relative path to its contents. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'convex-runtime-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return root;
}

describe('declaresUseNode', () => {
  it('accepts the directive on the first line', () => {
    expect(declaresUseNode("'use node';\n\nexport const x = 1;")).toBe(true);
  });

  it('accepts it after a leading block comment', () => {
    // A file whose licence or doc block comes first is still node-side.
    expect(declaresUseNode("/* header */\n'use node';\n")).toBe(true);
  });

  it('rejects a file with no directive', () => {
    expect(declaresUseNode('export const x = 1;')).toBe(false);
  });
});

describe('importsOf', () => {
  it('finds a value import, a re-export and a dynamic import', () => {
    const found = importsOf(
      "import a from './a';\nexport { b } from './b';\nconst c = await import('./c');",
    );
    expect(found).toEqual(['./a', './b', './c']);
  });

  it('ignores type-only imports and re-exports', () => {
    // Erased before bundling, so they cannot break a deploy. Files on main do
    // exactly this with `node:http` and deploy fine.
    const found = importsOf(
      "import type { X } from 'node:http';\nexport type { Y } from 'node:fs';",
    );
    expect(found).toEqual([]);
  });
});

describe('findOffenders', () => {
  it('flags a file that reaches a Node built-in with no directive', () => {
    const root = tree({
      'helper.ts':
        "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;",
    });
    const { offenders } = findOffenders(root);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('node:fs');
  });

  it('follows the chain out of the scanned tree, and reports it', () => {
    // The real break was indirect and left the scanned tree: a file under
    // convex/ imported a barrel in lib/, which re-exported a loader, which
    // imported node:fs. Only the convex file can carry the directive, so the
    // chain is what makes the report actionable — and the walk has to follow
    // imports beyond the directory it is scanning.
    const base = tree({
      'convex/entry.ts':
        "import { thing } from '../lib/index';\nexport const x = thing;",
      'lib/index.ts': "export { thing } from './loader';",
      'lib/loader.ts': "import fs from 'node:fs';\nexport const thing = fs;",
    });
    const { offenders } = findOffenders(path.join(base, 'convex'));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('entry.ts');
    expect(offenders[0]).toContain('loader.ts');
    expect(offenders[0]).toContain('node:fs');
  });

  it('accepts the same file once it declares itself node-side', () => {
    const root = tree({
      'helper.ts':
        "'use node';\nimport fs from 'node:fs';\nexport const x = fs;",
    });
    const { offenders, nodeSide } = findOffenders(root);
    expect(offenders).toEqual([]);
    expect(nodeSide).toBe(1);
  });

  it('ignores a test file, which is never deployed', () => {
    const root = tree({
      'thing.test.ts': "import fs from 'node:fs';\nexport const x = fs;",
    });
    expect(findOffenders(root).offenders).toEqual([]);
  });

  it('ignores a type-only path to a built-in', () => {
    const root = tree({
      'entry.ts':
        "import type { IncomingMessage } from 'node:http';\nexport type X = IncomingMessage;",
    });
    expect(findOffenders(root).offenders).toEqual([]);
  });

  it('does not follow bare package specifiers', () => {
    // A package that pulls Node in through its own dependencies is a hazard
    // this cannot see. Guessing at packages would produce false alarms, and a
    // guard that cries wolf gets switched off.
    //
    // The sibling file is named to collide with the package deliberately: if
    // the walk ever treated a bare specifier as a relative path, it would
    // resolve to `./zod.ts` and report a break that does not exist.
    const root = tree({
      'entry.ts': "import { z } from 'zod';\nexport const x = z;",
      'zod.ts': "import fs from 'node:fs';\nexport const z = fs;",
    });
    const { offenders } = findOffenders(root);
    // `zod.ts` is itself an offender — it is a real file reaching node:fs. What
    // must NOT happen is `entry.ts` being reported through it.
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('zod.ts');
    expect(offenders[0]).not.toContain('entry.ts');
  });

  it('terminates on a circular import', () => {
    const root = tree({
      'a.ts': "import { b } from './b';\nexport const a = b;",
      'b.ts': "import { a } from './a';\nexport const b = a;",
    });
    expect(findOffenders(root).offenders).toEqual([]);
  });

  it('finds every offender, not just the first', () => {
    const root = tree({
      'one.ts': "import fs from 'node:fs';\nexport const a = fs;",
      'two.ts': "import p from 'node:path';\nexport const b = p;",
    });
    expect(findOffenders(root).offenders).toHaveLength(2);
  });
});
