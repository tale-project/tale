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

import type { SkillManifestEntry, SkillTarget } from '../src/manifest';
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

const targetDir = (target: SkillTarget, name: string): string =>
  join(
    root,
    target === 'claude' ? '.claude/skills' : 'builtin-configs/skills',
    name,
  );

/** Run the engine with console captured, returning the exit code + combined output. */
async function run(
  manifest: readonly SkillManifestEntry[],
  check: boolean,
): Promise<{ code: number; out: string }> {
  const opts: SyncOptions = { repoRoot: root, manifest, check };
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

/** A minimal, self-contained shared skill (claude + builtin), plus a test file. */
function scaffoldDemo(): void {
  writeUnder(
    'skills/demo-skill/SKILL.md',
    '# Demo\nRun `bun scripts/hello.ts`.\n',
  );
  writeUnder(
    'skills/demo-skill/scripts/hello.ts',
    `console.log('hi', Bun.version);\n`,
  );
  writeUnder(
    'skills/demo-skill/scripts/hello.test.ts',
    `import { test } from 'bun:test';\n`,
  );
}

const BOTH: readonly SkillManifestEntry[] = [
  { name: 'demo-skill', targets: ['claude', 'builtin'] },
];

describe('runSync', () => {
  test('sync writes both targets and excludes test files', async () => {
    scaffoldDemo();
    const { code } = await run(BOTH, false);
    expect(code).toBe(0);
    for (const t of ['claude', 'builtin'] as const) {
      expect(existsSync(join(targetDir(t, 'demo-skill'), 'SKILL.md'))).toBe(
        true,
      );
      expect(
        existsSync(join(targetDir(t, 'demo-skill'), 'scripts/hello.ts')),
      ).toBe(true);
      expect(
        existsSync(join(targetDir(t, 'demo-skill'), 'scripts/hello.test.ts')),
      ).toBe(false);
    }
  });

  test('sync-then-check is clean (the core invariant)', async () => {
    scaffoldDemo();
    expect((await run(BOTH, false)).code).toBe(0);
    const checked = await run(BOTH, true);
    expect(checked.code).toBe(0);
    expect(checked.out).toContain('matches the source');
  });

  test('check fails (naming the file) when a copy is mutated', async () => {
    scaffoldDemo();
    await run(BOTH, false);
    writeFileSync(
      join(targetDir('builtin', 'demo-skill'), 'SKILL.md'),
      'tampered',
    );
    const checked = await run(BOTH, true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('changed: SKILL.md');
    expect(checked.out).toContain('bun run skills:sync');
  });

  test('check flags a stale extra, and the next sync deletes it', async () => {
    scaffoldDemo();
    await run(BOTH, false);
    writeFileSync(join(targetDir('builtin', 'demo-skill'), 'stray.txt'), 'x');
    expect((await run(BOTH, true)).code).toBe(1);
    expect((await run(BOTH, true)).out).toContain('stale:');

    await run(BOTH, false); // re-sync deletes the stray
    expect(
      existsSync(join(targetDir('builtin', 'demo-skill'), 'stray.txt')),
    ).toBe(false);
    expect((await run(BOTH, true)).code).toBe(0);
  });

  test('check fails when a copied file is deleted (missing)', async () => {
    scaffoldDemo();
    await run(BOTH, false);
    rmSync(join(targetDir('builtin', 'demo-skill'), 'scripts/hello.ts'));
    const checked = await run(BOTH, true);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('missing: scripts/hello.ts');
  });

  test('a builtin-only skill never lands under .claude/skills', async () => {
    scaffoldDemo();
    await run([{ name: 'demo-skill', targets: ['builtin'] }], false);
    expect(existsSync(targetDir('builtin', 'demo-skill'))).toBe(true);
    expect(existsSync(targetDir('claude', 'demo-skill'))).toBe(false);
  });

  test('binary assets round-trip byte-identical', async () => {
    writeUnder('skills/demo-skill/SKILL.md', '# Demo\n');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    writeUnder('skills/demo-skill/assets/logo.bin', bytes);
    await run([{ name: 'demo-skill', targets: ['builtin'] }], false);
    const copied = readFileSync(
      join(targetDir('builtin', 'demo-skill'), 'assets/logo.bin'),
    );
    expect([...copied]).toEqual([...bytes]);
  });

  test('check fails the portability guard on a bare import', async () => {
    writeUnder('skills/demo-skill/SKILL.md', '# Demo\n');
    writeUnder(
      'skills/demo-skill/scripts/bad.ts',
      `import { z } from 'zod';\n`,
    );
    const checked = await run(
      [{ name: 'demo-skill', targets: ['builtin'] }],
      true,
    );
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('"zod"');
  });
});
