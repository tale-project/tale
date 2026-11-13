// secrets: no secret value of the deployment reaches what the CLI says or
// keeps outside its two secret files (design R-15): not a plan, a receipt, a
// bundle, a report, a refusal, nor any line any suite made the CLI print. It
// runs last, over everything the suites before it made the CLI say, and adds
// the refusals a deployment with secrets can provoke.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  cli,
  currentRelease,
  deployed,
  jsonOf,
  loadLab,
  paths,
  prepared,
  sentinelOf,
} from '../harness';

setDefaultTimeout(30 * 60_000);
const lab = loadLab();
const at = paths(lab);

/** Every value of the generated secrets that could be told apart in text,
 * and the run's sentinel, which the specification declares as a secret. */
function secrets(): string[] {
  const values = readFileSync(join(at.state, 'secrets.env'), 'utf8')
    .split('\n')
    .map((line) => /^[A-Z][A-Z0-9_]*='?([^']*)'?$/.exec(line)?.[1] ?? '')
    .filter((value) => value.length >= 12);
  expect(values.length).toBeGreaterThan(3);
  return [...values, sentinelOf(lab)];
}

/** The files under `directory`, but the two that hold the secrets. */
function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(directory, entry))
    .filter(
      (path) =>
        statSync(path).isFile() &&
        !['secrets.env', 'src/.env'].includes(relative(at.state, path)) &&
        // The staged copies of the two, kept for the recovery of a deploy.
        !/\/\.tale\/runtime-[0-9a-f-]+\/(\.env|secrets\.env)$/.test(path) &&
        // The CLI copied into a bundle is code, not output.
        !/\/cli\/tale(\.mjs)?$/.test(path) &&
        // The credential export's own files hold its client's secret.
        !path.startsWith(join(lab.dir, 'exported-client')),
    );
}

describe('secrets', () => {
  test('a refusal names no secret', () => {
    deployed(lab);
    const bundle = prepared(lab, currentRelease(lab));
    const refusals = [
      // A plan file that is not one.
      cli(lab, ['--json', 'deploy', '--bundle', bundle, '--plan', at.sources]),
      // A release version the images do not carry.
      cli(lab, [
        '--json',
        'deploy',
        'accept',
        '--bundle',
        bundle,
        '--cli-ref',
        'f'.repeat(40),
        '--deployment-ref',
        lab.revision,
        '--expected-version',
        '9.9.9',
      ]),
    ];
    for (const run of refusals) {
      expect(run.code).not.toBe(0);
      expect(jsonOf(run).ok).toBe(false);
      for (const value of secrets()) {
        expect(run.stdout).not.toContain(value);
        expect(run.stderr).not.toContain(value);
      }
    }
  });

  test('no output, plan, receipt, bundle or report holds a secret', () => {
    deployed(lab);
    const plan = cli(lab, [
      '--json',
      'deploy',
      '--bundle',
      prepared(lab, currentRelease(lab)),
      '--plan-only',
    ]);
    expect(plan.code).toBe(0);
    const scanned = [
      join(at.logs, 'cli.log'),
      ...files(join(at.state, '.tale')),
      ...files(join(lab.dir, 'bundles')),
      ...files(at.report),
    ];
    expect(scanned.length).toBeGreaterThan(10);
    const values = secrets();
    const leaks = scanned.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return values
        .filter((value) => text.includes(value))
        .map(() => relative(lab.dir, file));
    });
    expect(leaks).toEqual([]);
  });
});
