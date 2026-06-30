import { describe, expect, test } from 'bun:test';

import { checkCommandRefs, checkImports, classifyImport } from '../src/guards';
import { type FileTree } from '../src/tree';

/** Build a FileTree from a plain object (utf-8 encoded values). */
function tree(entries: Record<string, string>): FileTree {
  const map: FileTree = new Map();
  const enc = new TextEncoder();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, enc.encode(value));
  }
  return map;
}

describe('classifyImport', () => {
  test('allows relative, node:, and bun specifiers', () => {
    for (const ok of [
      './util',
      '../shared/x',
      'node:fs',
      'node:path',
      'bun',
      'bun:test',
      'bun:sqlite',
    ]) {
      expect(classifyImport(ok)).toBe('ok');
    }
  });
  test('denies bare npm specifiers and absolute paths', () => {
    for (const bad of ['zod', 'lodash', '@scope/pkg', '/abs/path']) {
      expect(classifyImport(bad)).toBe('bad');
    }
  });
});

describe('checkImports', () => {
  test('passes a self-contained script', () => {
    const source = tree({
      'scripts/ok.ts': `import { readFileSync } from 'node:fs';\nimport { helper } from './util';\nconsole.log(readFileSync, helper, Bun.version);`,
    });
    expect(checkImports('demo', source)).toEqual([]);
  });

  test('flags a bare npm import with file + specifier', () => {
    const source = tree({
      'scripts/bad.ts': `import { z } from 'zod';\nconsole.log(z);`,
    });
    const violations = checkImports('demo', source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      skill: 'demo',
      file: 'scripts/bad.ts',
      specifier: 'zod',
    });
  });

  test('catches a dynamic import() of a bare specifier', () => {
    const source = tree({
      'scripts/dyn.ts': `export const load = () => import('lodash');`,
    });
    const violations = checkImports('demo', source);
    expect(violations.map((v) => v.specifier)).toContain('lodash');
  });

  test('ignores test files (never shipped)', () => {
    const source = tree({ 'scripts/x.test.ts': `import { z } from 'zod';` });
    expect(checkImports('demo', source)).toEqual([]);
  });

  test('ignores non-script TS and non-TS files', () => {
    const source = tree({
      'reference.ts': `import { z } from 'zod';`, // not under scripts/
      'scripts/notes.md': `import { z } from 'zod';`, // not a .ts file
    });
    expect(checkImports('demo', source)).toEqual([]);
  });
});

describe('checkCommandRefs', () => {
  test('passes when every referenced script exists', () => {
    const source = tree({
      'SKILL.md':
        'Run `bun scripts/run.ts` and `python scripts/office/unpack.py here`.',
      'scripts/run.ts': '',
      'scripts/office/unpack.py': '',
    });
    expect(checkCommandRefs('demo', source)).toEqual([]);
  });

  test('flags a reference to a missing script', () => {
    const source = tree({
      'SKILL.md': 'Run `bun scripts/missing.ts`.',
      'scripts/run.ts': '',
    });
    expect(checkCommandRefs('demo', source)).toEqual([
      { skill: 'demo', referenced: 'scripts/missing.ts' },
    ]);
  });

  test('ignores runner invocations that are not script paths (python -m markitdown)', () => {
    const source = tree({
      'SKILL.md': 'Run `python -m markitdown file.pptx`.',
    });
    expect(checkCommandRefs('demo', source)).toEqual([]);
  });

  test('ignores prose mentions of scripts/ without a runner', () => {
    const source = tree({ 'SKILL.md': 'See scripts/helper.py for details.' });
    expect(checkCommandRefs('demo', source)).toEqual([]);
  });

  test('de-duplicates repeated references', () => {
    const source = tree({
      'SKILL.md': 'bun scripts/x.ts then again bun scripts/x.ts',
    });
    expect(checkCommandRefs('demo', source)).toEqual([
      { skill: 'demo', referenced: 'scripts/x.ts' },
    ]);
  });

  test('reports a missing SKILL.md once', () => {
    expect(checkCommandRefs('demo', tree({ 'scripts/x.ts': '' }))).toEqual([
      { skill: 'demo', referenced: '<SKILL.md missing>' },
    ]);
  });
});
