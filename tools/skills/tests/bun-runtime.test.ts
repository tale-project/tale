/**
 * Capability proof: a skill can ship pure TypeScript that runs under Bun, called
 * the SAME skill-relative way (`bun scripts/<name>.ts`) regardless of where the
 * skill directory lives. We materialise a skill in a throwaway directory (a
 * stand-in for any of the four real locations), then invoke its script from that
 * directory exactly as an agent would.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkImports } from '../src/guards';
import { readTree } from '../src/tree';

let skillDir: string;

beforeEach(() => {
  skillDir = mkdtempSync(join(tmpdir(), 'tale-skills-runtime-'));
});
afterEach(() => {
  rmSync(skillDir, { recursive: true, force: true });
});

// A self-contained skill script: uses the global `Bun.*` API (no imports) to
// read its argument and write a sibling file, then prints a line.
const HELLO_TS = [
  '#!/usr/bin/env bun',
  "const who = process.argv[2] ?? 'world';",
  'const line = `hello ${who} from bun ${Bun.version}`;',
  "await Bun.write('out.txt', line);",
  'console.log(line);',
  '',
].join('\n');

describe('bun TypeScript skill scripts', () => {
  test('are self-contained (pass the import guard)', () => {
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'scripts', 'hello.ts'), HELLO_TS);
    expect(checkImports('demo', readTree(skillDir))).toEqual([]);
  });

  test('run via `bun scripts/<name>.ts` from the skill directory', async () => {
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'scripts', 'hello.ts'), HELLO_TS);

    // Invoke exactly as a SKILL.md documents it: skill-relative, cwd = skill dir.
    const proc = Bun.spawn(['bun', 'scripts/hello.ts', 'tale'], {
      cwd: skillDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain('hello tale from bun');
    // The Bun.* side effect landed relative to the skill dir.
    expect(readFileSync(join(skillDir, 'out.txt'), 'utf8')).toContain(
      'hello tale from bun',
    );
  });
});
