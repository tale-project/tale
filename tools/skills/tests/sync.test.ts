import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runSync, type SyncOptions } from '../src/sync';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tale-skills-sync-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a file under `root`, creating parent directories. */
function writeUnder(rel: string, content: string | Uint8Array): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Repo-relative path of a file in the generated `.claude/skills` mirror. */
const mirrored = (rel: string): string => join(root, '.claude/skills', rel);

/** Run the engine with console captured, returning the exit code + combined output. */
async function run(check: boolean): Promise<{ code: number; out: string }> {
  const opts: SyncOptions = { repoRoot: root, check };
  const origLog = console.log;
  const origErr = console.error;
  const lines: string[] = [];
  const collect = (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '));
  };
  console.log = collect;
  console.error = collect;
  try {
    const code = await runSync(opts);
    return { code, out: lines.join('\n') };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/** A repo-dev guide under the `.agents/skills` source, plus a stray test file. */
function scaffoldGuide(): void {
  writeUnder(
    '.agents/skills/demo/SKILL.md',
    '---\nname: demo\ndescription: x\n---\n\n# Demo\n',
  );
  writeUnder('.agents/skills/demo/reference.md', '# Reference\n');
  writeUnder(
    '.agents/skills/demo/demo.test.ts',
    `import { test } from 'bun:test';\n`,
  );
}

describe('runSync — mirror', () => {
  test('sync mirrors .agents/skills -> .claude/skills and excludes test files', async () => {
    scaffoldGuide();
    const { code } = await run(false);
    expect(code).toBe(0);
    expect(existsSync(mirrored('demo/SKILL.md'))).toBe(true);
    expect(existsSync(mirrored('demo/reference.md'))).toBe(true);
    expect(existsSync(mirrored('demo/demo.test.ts'))).toBe(false);
  });

  test('sync-then-check is clean (the core invariant)', async () => {
    scaffoldGuide();
    expect((await run(false)).code).toBe(0);
    const checked = await run(true);
    expect(checked.code).toBe(0);
    expect(checked.out).toContain('match their sources');
  });

  test('check fails (naming the file) when the mirror is mutated', async () => {
    scaffoldGuide();
    await run(false);
    writeFileSync(mirrored('demo/SKILL.md'), 'tampered');
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('changed: demo/SKILL.md');
    expect(checked.out).toContain('bun run skills:sync');
  });

  test('check flags a stale extra, and the next sync deletes it', async () => {
    scaffoldGuide();
    await run(false);
    writeFileSync(mirrored('demo/stray.txt'), 'x');
    expect((await run(true)).code).toBe(1);
    expect((await run(true)).out).toContain('stale:');

    await run(false); // re-sync deletes the stray
    expect(existsSync(mirrored('demo/stray.txt'))).toBe(false);
    expect((await run(true)).code).toBe(0);
  });

  test('check fails when a mirrored file is deleted (missing)', async () => {
    scaffoldGuide();
    await run(false);
    rmSync(mirrored('demo/reference.md'));
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('missing: demo/reference.md');
  });

  test('binary assets round-trip byte-identical', async () => {
    writeUnder(
      '.agents/skills/demo/SKILL.md',
      '---\nname: demo\ndescription: x\n---\n\n# Demo\n',
    );
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    writeUnder('.agents/skills/demo/assets/logo.bin', bytes);
    await run(false);
    const copied = readFileSync(mirrored('demo/assets/logo.bin'));
    expect([...copied]).toEqual([...bytes]);
  });
});

describe('runSync — workflow-skill projection', () => {
  /** A workflow skill at its `builtin-configs/skills` source of truth. */
  function scaffoldWorkflow(): void {
    writeUnder(
      'builtin-configs/skills/fix-bug/SKILL.md',
      '---\nname: fix-bug\ndescription: x\n---\n\n# Fix a bug\n',
    );
  }

  /** Repo-relative path of a file in the projected `.agents/skills` copy. */
  const projected = (rel: string): string => join(root, '.agents/skills', rel);

  test('sync projects a workflow skill builtin-configs -> .agents/skills -> .claude/skills', async () => {
    scaffoldWorkflow();
    expect((await run(false)).code).toBe(0);
    expect(existsSync(projected('fix-bug/SKILL.md'))).toBe(true);
    expect(existsSync(mirrored('fix-bug/SKILL.md'))).toBe(true);
  });

  test('product-only skills (docx, …) are NOT projected into the repo-dev guides', async () => {
    writeUnder(
      'builtin-configs/skills/docx/SKILL.md',
      '---\nname: docx\ndescription: x\n---\n\n# Docx\n',
    );
    expect((await run(false)).code).toBe(0);
    expect(existsSync(projected('docx/SKILL.md'))).toBe(false);
    expect(existsSync(mirrored('docx/SKILL.md'))).toBe(false);
  });

  test('check fails (pointing at builtin-configs) when the projected copy is hand-edited', async () => {
    scaffoldWorkflow();
    await run(false);
    writeFileSync(projected('fix-bug/SKILL.md'), 'tampered');
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('workflow-skill projection is out of date');
    expect(checked.out).toContain(
      'builtin-configs/skills/<name>/ is the source of truth',
    );
  });

  test('a deleted source with a surviving projection is a hard error (no silent wipe)', async () => {
    scaffoldWorkflow();
    await run(false);
    rmSync(join(root, 'builtin-configs/skills/fix-bug'), {
      recursive: true,
      force: true,
    });
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('no builtin-configs/skills/ source');
  });
});

describe('runSync — portability guards over shipped roots', () => {
  test('a bare import in a shipped skill fails the check', async () => {
    writeUnder(
      'skills/demo/SKILL.md',
      '---\nname: demo\ndescription: x\n---\n\n# Demo\n',
    );
    writeUnder('skills/demo/scripts/bad.ts', `import { z } from 'zod';\n`);
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('"zod"');
  });

  test('a SKILL.md command pointing at a missing script fails the check', async () => {
    writeUnder(
      'builtin-configs/skills/demo/SKILL.md',
      '---\nname: demo\ndescription: x\n---\n\n# Demo\nRun `python scripts/missing.py`.\n',
    );
    const checked = await run(true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('scripts/missing.py');
  });

  test('docs-only .agents/skills guides are NOT subject to the script guard', async () => {
    // A repo-dev guide may mention a repo command that is not a skill-relative
    // script; .agents/skills is excluded from the shipped roots, so this passes.
    writeUnder(
      '.agents/skills/guide/SKILL.md',
      '---\nname: guide\ndescription: x\n---\n\n# Guide\nRun `python scripts/nope.py`.\n',
    );
    expect((await run(false)).code).toBe(0);
    expect((await run(true)).code).toBe(0);
  });
});
