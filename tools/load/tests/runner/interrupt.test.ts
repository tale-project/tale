import { expect, test } from 'bun:test';
/**
 * Ctrl-C in a terminal reaches the whole process group. The workers must
 * leave it to the orchestrator, which winds them down over IPC and still
 * writes a report — not one listing every worker as failed.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const node = Bun.which('node');
const cli = join(import.meta.dir, '../../src/cli.ts');
const scenario = join(import.meta.dir, 'fixtures/idle-scenario.ts');

test.skipIf(node === null)(
  'an interrupted run winds its workers down and reports without failures',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-load-interrupt-'));
    const plan = {
      version: 1,
      createdAt: new Date().toISOString(),
      target: 'http://127.0.0.1:9',
      runId: 'intr1',
      users: {
        count: 4,
        emailDomain: 'load.tale.invalid',
        password: 'interrupt-test-password',
        sessionsMinted: false,
      },
      organizations: {
        count: 1,
        size: 4,
        megaOrgSize: 0,
        list: [
          {
            index: 0,
            id: 'o1',
            slug: 'o1',
            name: 'Interrupt',
            ownerIndex: 0,
            projectId: null,
            providerSlug: null,
            modelId: null,
          },
        ],
      },
      provider: null,
    };
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
    writeFileSync(join(dir, 'thresholds.json'), '{}');
    const report = join(dir, 'report.json');
    const child = spawn(
      node ?? 'node',
      [
        cli,
        'run',
        '--plan',
        join(dir, 'plan.json'),
        '--profile',
        'load',
        '--users',
        '4',
        '--ramp',
        '1',
        '--hold',
        '60',
        '--processes',
        '2',
        '--progress-seconds',
        '1',
        '--thresholds',
        join(dir, 'thresholds.json'),
        '--scenario-module',
        scenario,
        '--report',
        report,
      ],
      // Its own process group, so the signal reaches every process the way
      // a terminal's Ctrl-C does.
      { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    if (child.pid === undefined || child.exitCode !== null)
      throw new Error(`the run ended before the interrupt:\n${stderr}`);
    process.kill(-child.pid, 'SIGINT');
    const code = await exited;
    const written = JSON.parse(readFileSync(report, 'utf8')) as {
      passed: boolean;
      outcome: { workerFailures: string[]; stoppedEarly: boolean };
    };
    expect(written.outcome.workerFailures).toEqual([]);
    expect(written.outcome.stoppedEarly).toBe(true);
    expect(code).toBe(0);
  },
  30_000,
);
