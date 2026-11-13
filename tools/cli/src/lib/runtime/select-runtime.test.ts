import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError, ExitCode } from '../../utils/fail';
import { assertDockerLoop, declaredEngine } from '../project/declared-engine';
import { runtimeForEngine, selectRuntime } from './select-runtime';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tale-select-runtime-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const incus = {
  project: 'tale-demo',
  pool: 'tank',
  network: {
    name: 'tale-demo',
    subnet: '10.30.0.0/24',
    gateway: '10.30.0.1',
    block: '10.30.0.0/24',
  },
  sessions: { subnet: '10.31.0.0/24' },
  ingress: { mode: 'proxy-device' },
};

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

  test('an explicit docker engine is Docker', async () => {
    writeTaleJson({ runtime: { engine: 'docker' } });
    expect(await declaredEngine(dir)).toBe('docker');
  });

  test('an Incus block beside Docker is refused, never read by nothing', async () => {
    writeTaleJson({ runtime: { engine: 'docker', incus: { project: 'x' } } });
    const error = await refusal(declaredEngine(dir));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('runtime.incus');
  });

  test('incus is declared, and refused for a workspace until it is available', async () => {
    writeTaleJson({ runtime: { engine: 'incus', incus } });
    expect(await declaredEngine(dir, {})).toBe('incus');
    const error = await refusal(selectRuntime(dir));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('not available yet');
    expect(error.message).toContain('workspace');
  });

  test('an engine the CLI does not know is refused, never read as Docker', async () => {
    writeTaleJson({ runtime: { engine: 'podman' } });
    const error = await refusal(declaredEngine(dir));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('runtime.engine');
  });

  test('TALE_RUNTIME guards the declared engine and never selects one', async () => {
    writeTaleJson();
    expect(await declaredEngine(dir, { TALE_RUNTIME: 'docker' })).toBe(
      'docker',
    );
    const error = await refusal(declaredEngine(dir, { TALE_RUNTIME: 'incus' }));
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('TALE_RUNTIME');
    // Without tale.json the workspace is Docker, and the guard still holds.
    rmSync(join(dir, 'tale.json'));
    await refusal(declaredEngine(dir, { TALE_RUNTIME: 'incus' }));
  });
});

describe('the local developer loops stay on Docker', () => {
  test('no workspace, or a Docker one, runs them', async () => {
    await assertDockerLoop(null, 'tale dev', {});
    writeTaleJson();
    await assertDockerLoop(dir, 'tale dev', {});
    writeTaleJson({ runtime: { engine: 'docker' } });
    await assertDockerLoop(dir, 'a sandbox device', {});
  });

  test.each(['tale dev', 'a sandbox device'] as const)(
    'an Incus workspace refuses %s in one sentence that says why',
    async (loop) => {
      writeTaleJson({ runtime: { engine: 'incus', incus } });
      const error = await refusal(assertDockerLoop(dir, loop, {}));
      expect(error.info.code).toBe(ExitCode.Precondition);
      expect(error.message).toBe(
        `This workspace declares runtime.engine "incus", but ${loop} runs on Docker only: it is a local developer loop, and Incus runs on Linux only.`,
      );
    },
  );

  test('an unreadable declaration is refused, never read as Docker', async () => {
    writeTaleJson({ runtime: { engine: 'podman' } });
    const error = await refusal(assertDockerLoop(dir, 'tale dev', {}));
    expect(error.message).toContain('runtime.engine');
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
