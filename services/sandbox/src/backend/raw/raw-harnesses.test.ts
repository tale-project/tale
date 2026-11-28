import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectHarnesses,
  HARNESS_PROBES,
  readVersion,
} from './raw-harnesses.ts';
import type { RawProcesses } from './raw-processes.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function binDir(programs: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-raw-harness-'));
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  for (const program of programs) {
    await writeFile(join(dir, program), '#!/bin/sh\n');
    await chmod(join(dir, program), 0o755);
  }
  return dir;
}

const versions: RawProcesses = {
  list: async () => [],
  identity: async () => null,
  signal: () => false,
  launch: async () => 0,
  run: async (argv) => ({
    code: 0,
    stdout: argv[0]?.endsWith('/claude')
      ? '2.1.285 (Claude Code)\n'
      : 'codex-cli 0.160.0\n',
    stderr: '',
  }),
};

describe('readVersion', () => {
  it('takes the first dotted number a program prints', () => {
    expect(readVersion('2.1.285 (Claude Code)')).toBe('2.1.285');
    expect(readVersion('codex-cli 0.160.0')).toBe('0.160.0');
    expect(readVersion('openclaw 2026.9.8-beta.1')).toBe('2026.9.8-beta.1');
    expect(readVersion('no version here')).toBeNull();
  });
});

describe('detectHarnesses', () => {
  it('reports a harness whose program and needs are found', async () => {
    const dir = await binDir(['claude', 'bash', 'jq', 'codex']);
    expect(await detectHarnesses([dir], versions)).toEqual([
      { id: 'claude-code', version: '2.1.285' },
      { id: 'codex', version: '0.160.0' },
    ]);
  });

  it('leaves out a harness whose wrapper needs are missing', async () => {
    const dir = await binDir(['claude', 'pi']);
    expect(await detectHarnesses([dir], versions)).toEqual([]);
  });

  it('knows every harness of the registry', () => {
    expect(HARNESS_PROBES.map((probe) => probe.id).sort()).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'gemini',
      'hermes',
      'openclaw',
      'opencode',
      'pi',
      'qwen-code',
    ]);
  });
});
