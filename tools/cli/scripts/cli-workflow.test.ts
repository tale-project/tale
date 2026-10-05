import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

type Platform = {
  os: string;
  platform: string;
  cross?: boolean;
};
type Step = {
  name: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  'working-directory'?: string;
};
type Workflow = {
  jobs: {
    build: {
      strategy: { 'fail-fast': boolean; matrix: { include: Platform[] } };
      steps: Step[];
    };
  };
};

async function buildJob() {
  const source = await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  );
  return (parse(source) as Workflow).jobs.build;
}

describe('CLI builds retain native execution coverage without duplicate host suites', () => {
  test('each supported host runs source tests and its compiled binary smoke suite', async () => {
    const job = await buildJob();
    const native = job.strategy.matrix.include.filter((entry) => !entry.cross);
    expect(native.map((entry) => entry.platform).toSorted()).toEqual([
      'linux',
      'macos',
      'windows',
    ]);
    expect(new Set(native.map((entry) => entry.os)).size).toBe(native.length);
    expect(job.strategy['fail-fast']).toBe(false);
    for (const name of ['Run unit tests', 'Verify binary', 'Run smoke tests']) {
      const step = job.steps.find((entry) => entry.name === name);
      expect(step?.if).toBe('${{ !matrix.cross }}');
      expect(step?.run).toBeTruthy();
    }
    for (const entry of job.strategy.matrix.include.filter(
      (leg) => leg.cross,
    )) {
      expect(native.some((host) => host.os === entry.os)).toBe(true);
    }
    expect(
      job.steps.find((entry) => entry.name === 'Build binary')?.if,
    ).toBeUndefined();
  });

  test('one install step selects native or cross dependencies before generation', async () => {
    const job = await buildJob();
    const installs = job.steps.filter((entry) =>
      entry.run?.includes('bun install'),
    );
    expect(installs).toHaveLength(1);
    const install = installs[0];
    expect(install?.name).toBe('Install dependencies');
    expect(install?.if).toBeUndefined();
    expect(install?.env?.CROSS).toBe('${{ matrix.cross }}');
    expect(install?.['working-directory']).toBe('tools/cli');
    expect(job.steps.indexOf(install!)).toBeLessThan(
      job.steps.findIndex((entry) => entry.name === 'Generate embedded files'),
    );
  });
});
