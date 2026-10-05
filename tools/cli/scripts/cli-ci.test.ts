import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

type Step = {
  name: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
type Target = {
  os: string;
  platform: string;
  artifact: string;
  cross?: boolean;
};

const workflow = parse(
  await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: {
    build: {
      strategy: { 'fail-fast': boolean; matrix: { include: Target[] } };
      steps: Step[];
    };
    release: { needs: string[]; if: string; steps: Step[] };
  };
};

const build = workflow.jobs.build;
const step = (name: string) => {
  const found = build.steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`CLI build step is missing: ${name}`);
  return found;
};

test('source tests run once per host OS while every target still builds', () => {
  const targets = build.strategy.matrix.include;
  const native = targets.filter((target) => !target.cross);
  const cross = targets.filter((target) => target.cross);
  expect(native.map((target) => target.platform).sort()).toEqual([
    'linux',
    'macos',
    'windows',
  ]);
  expect(cross.map((target) => target.platform).sort()).toEqual([
    'linux-arm64',
    'macos-x64',
  ]);
  for (const target of cross) {
    // Omitting duplicate source tests is safe only while the same OS/host
    // runs them in a native row of the same, non-short-circuiting matrix.
    expect(native.filter((host) => host.os === target.os)).toHaveLength(1);
  }
  expect(build.strategy['fail-fast']).toBe(false);
  expect(step('Run unit tests').if).toBe('${{ !matrix.cross }}');
  expect(step('Run unit tests').run).toBe(
    "${{ matrix.platform == 'macos' && 'bun run test --parallel=2' || 'bun run test' }}",
  );
  expect(step('Build binary').if).toBeUndefined();
  expect(step('Build binary').run).toContain('bun run "$BUILD_SCRIPT"');
  expect(step('Build binary').env).toEqual({
    PLATFORM: '${{ matrix.platform }}',
    BUILD_SCRIPT: '${{ matrix.build_script }}',
  });
  expect(step('Run type check').if).toBe("matrix.platform == 'linux'");
});

test('native smoke coverage and cross macOS signature checks remain blocking', () => {
  expect(step('Verify binary').if).toBe('${{ !matrix.cross }}');
  expect(step('Run smoke tests').if).toBe('${{ !matrix.cross }}');
  expect(step('Run smoke tests').run).toBe('bun run test tests/');
  for (const name of [
    'Normalize macOS code signature',
    'Verify macOS code signature',
  ]) {
    expect(step(name).if).toBe("startsWith(matrix.platform, 'macos')");
  }
  expect(step('Verify macOS code signature').run).toContain(
    'codesign --verify --strict',
  );
  expect(
    build.strategy.matrix.include.map((target) => target.artifact).sort(),
  ).toEqual([
    'tale_linux',
    'tale_linux_arm64',
    'tale_macos',
    'tale_macos_x64',
    'tale_windows.exe',
  ]);
  expect(step('Upload artifact').with?.name).toBe('${{ matrix.artifact }}');
  expect(workflow.jobs.release.needs).toContain('build');
  expect(workflow.jobs.release.if).toContain("needs.build.result == 'success'");
});

test('Bun dependency caches are isolated by operating system and host architecture', () => {
  const cache = step('Restore Bun install cache').with!;
  expect(cache.key).toContain('${{ runner.os }}-${{ runner.arch }}');
  expect(cache['restore-keys']).toContain(
    '${{ runner.os }}-${{ runner.arch }}',
  );
});
