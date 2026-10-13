import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import {
  crossesCutover,
  FINGERPRINT_SQL,
  parseFingerprint,
  parseUpgradeCheckArgs,
} from './workspace-upgrade-check';

test('the upgrade check needs a release to start from, a CLI and a workdir', () => {
  expect(
    parseUpgradeCheckArgs([
      '--from',
      '0.5.77',
      '--cli',
      'dist/tale',
      '--workdir',
      '/tmp/upgrade',
    ]),
  ).toEqual({
    from: '0.5.77',
    cli: resolve('dist/tale'),
    workdir: '/tmp/upgrade',
    keep: false,
  });
  expect(
    parseUpgradeCheckArgs([
      '--keep',
      '--from',
      '0.5.88',
      '--cli',
      '/x/tale',
      '--workdir',
      '/w',
    ]).keep,
  ).toBe(true);
  for (const args of [
    [],
    ['--from', '0.5.77', '--cli', '/x/tale'],
    ['--from', 'v0.5.77', '--cli', '/x/tale', '--workdir', '/w'],
    ['--from', '--cli', '/x/tale', '--workdir', '/w'],
  ])
    expect(() => parseUpgradeCheckArgs(args)).toThrow();
});

test('only a workspace older than writer protocol 2 crosses the cutover', () => {
  for (const version of ['0.5.77', '0.5.0', '0.4.9'])
    expect(crossesCutover(version)).toBe(true);
  for (const version of ['0.5.78', '0.5.89', '0.6.0', '1.0.0'])
    expect(crossesCutover(version)).toBe(false);
});

test('the fingerprint compares accounts, organizations and memberships', () => {
  expect(FINGERPRINT_SQL).toContain('public."user"');
  expect(FINGERPRINT_SQL).toContain('public.organization');
  expect(FINGERPRINT_SQL).toContain('public.member');
  expect(
    parseFingerprint('users|1\norganizations|a-org,b-org\nmembers|2\n'),
  ).toEqual({ users: '1', organizations: 'a-org,b-org', members: '2' });
});

test('the workflow upgrades from v0.5.77 and the previous release, outside the merge gate', () => {
  const source = readFileSync(
    resolve(
      import.meta.dir,
      '../../../.github/workflows/workspace-upgrade.yml',
    ),
    'utf8',
  );
  const workflow = parse(source) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        strategy: { matrix: { leg: string[] } };
        steps: { name?: string; run?: string }[];
      }
    >;
  };
  expect(Object.keys(workflow.on).sort()).toEqual([
    'schedule',
    'workflow_dispatch',
  ]);
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const job = workflow.jobs.upgrade!;
  expect(job.strategy.matrix.leg).toEqual(['cutover', 'previous']);
  const run = job.steps.map((step) => step.run ?? '').join('\n');
  expect(run).toContain("from='0.5.77'");
  expect(run).toContain('releases/latest');
  expect(run).toContain('bun tools/cli/scripts/workspace-upgrade-check.ts');
  expect(run).toContain('--from "$FROM"');
});
