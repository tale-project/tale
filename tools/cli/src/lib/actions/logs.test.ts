import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SPLIT, THREE_WAY, UNIFIED, type AppTier } from '../compose/app-tier';
import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';
import { setCurrentColor } from '../state/set-current-color';
import { logs } from './logs';

/**
 * `tale logs <service>` reads one container. A colour runs its API and its
 * jobs in services of their own or inside `platform` (compose/app-tier.ts),
 * so the service an operator names may be a process of another name.
 */
setProjectId('tale');

let deployDir = '';
let written: string[] = [];
let stdout: ReturnType<typeof spyOn> | undefined;

beforeEach(async () => {
  deployDir = mkdtempSync(join(tmpdir(), 'tale-logs-test-'));
  await setCurrentColor(deployDir, 'blue');
  written = [];
  stdout = spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  stdout?.mockRestore();
  rmSync(deployDir, { recursive: true, force: true });
});

/** The live blue colour in a shape: each replica's log names its container. */
function live(tier: AppTier): FakeRuntime {
  const runtime = new FakeRuntime();
  for (const service of tier.services) {
    const role = tier.roles[service];
    runtime.seedInstance({
      stack: 'tale-blue',
      service,
      image: 'ghcr.io/tale-project/tale/tale-platform:0.6.1',
      environment:
        role === undefined || role === 'web' ? {} : { TALE_ROLE: role },
      log: [`the log of ${service}`],
    });
  }
  return runtime;
}

const shown = async (
  runtime: FakeRuntime,
  service: string,
): Promise<string[]> => {
  written = [];
  await logs({ service, follow: false, raw: true, deployDir, runtime });
  return written.filter((line) => line.startsWith('the log of '));
};

describe('tale logs, in a colour of any shape', () => {
  test("one process: its log is the API's and the jobs' too", async () => {
    const runtime = live(UNIFIED);
    expect(await shown(runtime, 'platform')).toEqual(['the log of platform\n']);
    expect(await shown(runtime, 'backend-api')).toEqual([
      'the log of platform\n',
    ]);
    expect(await shown(runtime, 'backend-worker')).toEqual([
      'the log of platform\n',
    ]);
  });

  test('the jobs apart: the API is platform, the jobs their own service', async () => {
    const runtime = live(SPLIT);
    expect(await shown(runtime, 'backend-api')).toEqual([
      'the log of platform\n',
    ]);
    expect(await shown(runtime, 'backend-worker')).toEqual([
      'the log of backend-worker\n',
    ]);
  });

  test('three services: each has its own, and a missing one is never read from platform', async () => {
    const runtime = live(THREE_WAY);
    expect(await shown(runtime, 'backend-api')).toEqual([
      'the log of backend-api\n',
    ]);
    expect(await shown(runtime, 'backend-worker')).toEqual([
      'the log of backend-worker\n',
    ]);
    // Its platform is the web tier alone: a worker that is gone has no log
    // there.
    runtime.instances.delete('tale-blue-backend-worker-1');
    await expect(
      logs({
        service: 'backend-worker',
        follow: false,
        raw: true,
        deployDir,
        runtime,
      }),
    ).rejects.toThrow('No active deployment');
  });

  test('a colour that is not up has no log to stand in', async () => {
    await expect(
      logs({
        service: 'backend-api',
        follow: false,
        raw: true,
        deployDir,
        runtime: new FakeRuntime(),
      }),
    ).rejects.toThrow('No active deployment');
  });
});
