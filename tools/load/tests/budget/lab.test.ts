/**
 * The sampler against a real cgroup: a process in a systemd scope of its
 * own holds 64 MiB of anonymous memory, and the sampler finds its cgroup
 * from its process and reads it as it reads a container's.
 *
 * Opt-in (`TALE_LOAD_CGROUP_LAB=1`): it needs a cgroup v2 host whose user
 * manager delegates the memory controller (`systemd-run --user --scope`).
 * Skipped anywhere else.
 */

import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { HOST_LOCATOR, isUnifiedHierarchy } from '../../src/budget/cgroup.ts';
import type { ContainerSource } from '../../src/budget/docker.ts';
import { MIB } from '../../src/budget/limits.ts';
import { BudgetSampler } from '../../src/budget/sampler.ts';

function labReason(): string | null {
  if (process.env.TALE_LOAD_CGROUP_LAB !== '1') {
    return 'set TALE_LOAD_CGROUP_LAB=1 to run it';
  }
  if (!isUnifiedHierarchy(HOST_LOCATOR.root)) return 'no cgroup v2 here';
  const probe = spawnSync('systemd-run', ['--user', '--version'], {
    encoding: 'utf8',
  });
  return probe.status === 0 ? null : 'no systemd-run --user here';
}

const reason = labReason();

const HOLD = `
const held = Buffer.alloc(64 * 1024 * 1024, 7);
process.stdout.write('holding ' + held.length + '\\n');
setInterval(() => held[0]++, 50);
`;

describe('the sampler on a real systemd scope', () => {
  test.skipIf(reason !== null)(
    'reads the scope’s memory.stat through its process, the held memory counted',
    async () => {
      const unit = `tale-load-lab-${randomBytes(4).toString('hex')}`;
      const child = spawn(
        'systemd-run',
        [
          '--user',
          '--scope',
          '--quiet',
          '--collect',
          `--unit=${unit}`,
          '-p',
          'MemoryMax=512M',
          '--',
          process.execPath,
          '-e',
          HOLD,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('holding')) resolve();
          });
          child.once('exit', (code) =>
            reject(new Error(`the held process exited early (${code})`)),
          );
          setTimeout(
            () => reject(new Error('the held process never started')),
            15_000,
          );
        });
        const pid = child.pid ?? 0;
        const source: ContainerSource = {
          list: async () => [
            {
              id: unit,
              name: unit,
              project: 'lab',
              service: 'platform',
              colour: null,
              pid,
            },
          ],
          engine: async () => ({
            cgroupDriver: 'systemd',
            cgroupVersion: 2,
            serverVersion: null,
            architecture: process.arch,
            rootless: false,
          }),
        };
        const sampler = new BudgetSampler({
          source,
          locator: HOST_LOCATOR,
          intervalMs: 50,
          discoveryMs: 200,
        });
        await sampler.open();
        sampler.run();
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const figures = await sampler.stop();
        const scope = figures.containers[0];
        expect(scope?.via).toBe('proc');
        expect(scope?.cgroup).toEndWith(`/${unit}.scope`);
        expect(scope?.samples).toBeGreaterThanOrEqual(10);
        expect(scope?.peakFields?.anon).toBeGreaterThanOrEqual(64 * MIB);
        expect(scope?.peakCounted).toBeGreaterThanOrEqual(64 * MIB);
        // Well under the scope's cap: the reading is the process's, not a cap.
        expect(scope?.peakCounted).toBeLessThan(256 * MIB);
        expect(figures.peak?.counted).toBe(scope?.peakCounted);
        expect(figures.maxGapMs).toBeLessThan(500);
        console.log(
          `[lab] ${unit}: peak counted ${(figures.peak?.counted ?? 0) / MIB} MiB (anon ${(scope?.peakFields?.anon ?? 0) / MIB} MiB), page cache at peak ${(scope?.fileAtPeak ?? 0) / MIB} MiB over ${figures.instants} instants`,
        );
      } finally {
        child.kill('SIGTERM');
      }
    },
    30_000,
  );
});
