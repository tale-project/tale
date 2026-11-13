// logs: the console of an Incus instance as `tale logs` reads it (design 11,
// R3-07). A read takes the lines it shows, so a running console is read only
// when asked to, after a one-line warning; `--since` is refused, because the
// console keeps no times; `--follow` polls until the instance stops, and
// every line comes out once. The verb runs here against the node with the
// stack's restricted certificate; the compiled `tale logs` reaches it from a
// workspace, which runs on Incus with the workspace's own credentials, and
// the suite holds the refusal of a workspace that has none.

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  consumingReadWarning,
  readInstanceLogs,
} from '../../../src/lib/runtime/incus/verbs/logs';
import {
  cli,
  deployed,
  loadLab,
  record,
  removeScratch,
  scratchInstance,
  verbContext,
} from '../harness';

setDefaultTimeout(30 * 60_000);
const lab = loadLab();
const TALKER = 'e2e-talker';
/** Thirty numbered lines a second apart, then the service ends. */
const SCRIPT =
  'i=0; while [ $i -lt 30 ]; do echo "e2e line $i"; i=$((i+1)); sleep 1; done';

afterAll(() => removeScratch(lab, TALKER));

describe('logs', () => {
  test('a running console is not read without --consume, and --since is refused', async () => {
    deployed(lab);
    scratchInstance(lab, TALKER, SCRIPT, {
      want: 'stopped',
      autorestart: false,
    });
    const context = await verbContext(lab);
    const refused = await readInstanceLogs(context, TALKER, {
      follow: false,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(refused)).toContain(
      'reading its console takes the lines it shows',
    );
    const since = await readInstanceLogs(context, TALKER, {
      follow: false,
      since: '10m',
      consume: true,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(since)).toContain('--since cannot be honoured on Incus');
  });

  test('--follow --consume warns once, polls, and shows every line once until the service ends', async () => {
    const context = await verbContext(lab);
    const lines: string[] = [];
    const warnings: string[] = [];
    let polls = 0;
    const started = performance.now();
    const code = await readInstanceLogs(
      context,
      TALKER,
      { follow: true, consume: true },
      (line) => lines.push(line),
      {
        pollMs: 500,
        warn: (line) => warnings.push(line),
        sleep: (ms) => {
          polls += 1;
          return Bun.sleep(ms);
        },
      },
    );
    record(lab, 'logs', {
      followMs: Math.round(performance.now() - started),
      polls,
      lines: lines.length,
    });
    expect(code).toBe(0);
    expect(warnings).toEqual([consumingReadWarning(TALKER)]);
    expect(polls).toBeGreaterThan(5);
    const numbered = lines.filter((line) => line.startsWith('e2e line '));
    // Each line once: a later poll never shows what an earlier one took.
    expect(new Set(numbered).size).toBe(numbered.length);
    expect(numbered.at(-1)).toBe('e2e line 29');
  });

  test('the compiled tale logs refuses a workspace on Incus without its credentials', () => {
    const workspace = mkdtempSync(join(lab.dir, 'workspace-'));
    writeFileSync(
      join(workspace, 'tale.json'),
      `${JSON.stringify({
        version: 1,
        cliVersion: '1.0.0',
        createdAt: '2026-11-13T00:00:00.000Z',
        id: `${lab.name}-ws`,
        runtime: {
          engine: 'incus',
          incus: {
            project: `${lab.name}-ws`,
            pool: lab.pool,
            network: {
              name: `${lab.name}-w`.slice(0, 15),
              subnet: '10.250.0.0/24',
              gateway: '10.250.0.1',
              block: '10.250.0.0/24',
            },
            sessions: { subnet: '10.251.0.0/24' },
            ingress: { mode: 'routed' },
          },
        },
      })}\n`,
    );
    writeFileSync(join(workspace, '.env'), 'HOST=ws.lab.invalid\n');
    const run = cli(lab, ['logs', 'platform'], { cwd: workspace });
    expect(run.code).toBe(3);
    const output = `${run.stdout}${run.stderr}`;
    // No credentials directory at all: the custody check names it missing
    // ("The Incus credentials in <dir> cannot be used" is for files that are
    // there but make no connection).
    expect(output).toContain(
      `The Incus credentials directory ${join(workspace, '.tale', 'incus')} is missing`,
    );
    expect(output).toContain('TALE_INCUS_DIR');
  });
});
