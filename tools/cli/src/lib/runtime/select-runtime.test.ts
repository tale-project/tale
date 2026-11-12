import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError, ExitCode } from '../../utils/fail';
import {
  declaredEngine,
  runtimeForEngine,
  selectRuntime,
} from './select-runtime';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tale-select-runtime-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeTaleJson(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(dir, 'tale.json'),
    JSON.stringify({
      version: 1,
      cliVersion: '0.6.0',
      createdAt: '2026-11-12T00:00:00.000Z',
      id: 'demo-abc123',
      ...extra,
    }),
  );
}

async function refusal(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the runtime a workspace declares', () => {
  test('a workspace that declares none runs on Docker', async () => {
    writeTaleJson();
    expect(await declaredEngine(dir)).toBe('docker');
    expect((await selectRuntime(dir)).engine).toBe('docker');
  });

  test('a directory without tale.json declares nothing, which is Docker', async () => {
    expect(await declaredEngine(dir)).toBe('docker');
  });

  test('an explicit docker engine is Docker, and keys beside it are kept for later', async () => {
    writeTaleJson({ runtime: { engine: 'docker', incus: { project: 'x' } } });
    expect(await declaredEngine(dir)).toBe('docker');
  });

  test('incus is declared, and refused until the Incus runtime exists', async () => {
    writeTaleJson({ runtime: { engine: 'incus' } });
    expect(await declaredEngine(dir)).toBe('incus');
    const error = await refusal(selectRuntime(dir));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('not built yet');
  });

  test('an engine the CLI does not know is refused, never read as Docker', async () => {
    writeTaleJson({ runtime: { engine: 'podman' } });
    const error = await refusal(declaredEngine(dir));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('runtime engine');
  });
});

describe('runtimeForEngine', () => {
  test('hands the Docker runtime the collaborators a command injects', async () => {
    const asked: Array<{ assumeYes?: boolean }> = [];
    const runtime = runtimeForEngine('docker', {
      docker: {
        ensureDocker: async (options = {}) => {
          asked.push(options);
          return { status: 'ready', detail: 'stub' };
        },
      },
    });
    expect(await runtime.probe({ assumeYes: true })).toEqual({
      status: 'ready',
      detail: 'stub',
    });
    expect(asked).toEqual([{ assumeYes: true }]);
  });
});
