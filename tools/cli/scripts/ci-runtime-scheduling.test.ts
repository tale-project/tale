import { describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const imageSuite =
  'services/platform/tests/integration/container-image-test.ts';
const runtimeSuite =
  'services/platform/tests/integration/container-sandbox-runtime-test.ts';
type Step = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  if?: string;
  needs?: string | string[];
  steps: Step[];
};
const workflow = async () =>
  parse(
    await readFile(join(repository, '.github/workflows/build.yml'), 'utf8'),
  ) as { jobs: Record<string, Job> };

describe('container validation scheduling', () => {
  test('both probes reuse accepted images after the frozen workspace setup', async () => {
    const job = (await workflow()).jobs['image-validate']!;
    const pullIndex = job.steps.findIndex(
      (step) => step.name === 'Pull images from GHCR',
    );
    const setupIndex = job.steps.findIndex(
      (step) => step.uses === './.github/actions/setup-turbo',
    );
    const probeIndex = job.steps.findIndex(
      (step) =>
        step.run?.includes(imageSuite) && step.run.includes(runtimeSuite),
    );
    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThan(pullIndex);
    expect(probeIndex).toBeGreaterThan(setupIndex);
    const probe = job.steps[probeIndex]!;
    expect(probe.if).toBeUndefined();
    expect(probe.env).toEqual({
      SKIP_BUILD: 'true',
    });
    expect(probe.run).not.toContain('${{');
    expect(
      job.steps.flatMap(
        (step) =>
          step.run?.match(/container-(?:image|sandbox-runtime)-test\.ts/g) ??
          [],
      ),
    ).toHaveLength(2);
    expect(job.needs).toEqual(['changes', 'build']);
    expect(job.if).toContain("needs.build.result == 'success'");
    expect(job.if).toContain(
      'github.event.pull_request.head.repo.fork != true',
    );
    expect((await workflow()).jobs['candidate-gate']!.needs).toContain(
      'image-validate',
    );
    const logsIndex = job.steps.findIndex(
      (step) => step.name === 'Upload image validation logs',
    );
    expect(logsIndex).toBeGreaterThan(probeIndex);
    expect(job.steps[logsIndex]!.if).toBe('always()');
    expect(job.steps[logsIndex]!.with).toEqual({
      name: 'image-validation-logs-attempt-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/image-validation.*/*.log',
      'retention-days': 7,
      'if-no-files-found': 'ignore',
    });
  });

  test('historical candidates retain the trusted image helper and forks finish their local build before conformance', async () => {
    const jobs = (await workflow()).jobs;
    const trusted = jobs['image-validate']!;
    const helper = trusted.steps.find(
      (step) => step.name === 'Checkout CI image pull helper',
    )!;
    expect(helper.if).toBe("needs.changes.outputs.candidate_sha != ''");
    expect(helper.with?.ref).toBe('${{ github.workflow_sha }}');
    expect(helper.with?.path).toBe('.ci-workflow');
    expect(helper.with?.['sparse-checkout']).toBe(
      '.github/scripts/pull-ci-images.sh',
    );
    expect(helper.with?.['persist-credentials']).toBe(false);
    const fork = jobs['image-validate-fork']!;
    const buildIndex = fork.steps.findIndex(
      (step) => step.run === `bun ${imageSuite}`,
    );
    const runtimeIndex = fork.steps.findIndex(
      (step) => step.run === `bun ${runtimeSuite}`,
    );
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeIndex).toBeGreaterThan(buildIndex);
    expect(fork.steps[buildIndex]!.env?.SKIP_BUILD).toBeUndefined();
    expect(fork.steps[runtimeIndex]!.env).toEqual({
      SKIP_BUILD: 'true',
      IMAGE: 'tale-sandbox-runtime:latest',
    });
  });

  test.skipIf(process.platform === 'win32').each([
    [0, 0],
    [37, 0],
    [0, 41],
    [37, 41],
  ])(
    'actual workflow overlaps both suites and retains both logs with exits %i/%i',
    async (imagesExit, runtimeExit) => {
      const job = (await workflow()).jobs['image-validate']!;
      const probe = job.steps.find(
        (step) =>
          step.run?.includes(imageSuite) && step.run.includes(runtimeSuite),
      )!;
      const directory = await mkdtemp(
        join(tmpdir(), 'tale-ci-runtime-scheduling-'),
      );
      try {
        await mkdir(join(directory, 'logs with spaces'));
        await writeFile(
          join(directory, 'bun'),
          `#!/bin/sh
set -eu
case "$1" in
  */container-image-test.ts) suite=images; result="$TEST_IMAGES_EXIT" ;;
  */container-sandbox-runtime-test.ts) suite=runtime; result="$TEST_RUNTIME_EXIT" ;;
  *) exit 99 ;;
esac
printf '%s|%s|%s|%s\\n' "$1" "$SKIP_BUILD" "\${PULL_POLICY:-}" "\${IMAGE:-}" >> "$TEST_STATE/calls"
printf 'start %s\\n' "$suite" >> "$TEST_STATE/events"
touch "$TEST_STATE/$suite.started"
attempts=0
# Neither child can finish until both have entered. A serial orchestrator
# fails this barrier instead of relying on a machine-speed assertion.
while [ ! -f "$TEST_STATE/images.started" ] || [ ! -f "$TEST_STATE/runtime.started" ]; do
  attempts=$((attempts + 1))
  [ "$attempts" -le 1000 ] || exit 98
  sleep 0.01
done
if [ "$suite" = runtime ]; then
  attempts=0
  while [ ! -f "$TEST_STATE/images.finished" ]; do
    attempts=$((attempts + 1))
    [ "$attempts" -le 1000 ] || exit 97
    sleep 0.01
  done
fi
printf '%s stdout complete\\n' "$suite"
printf '%s stderr complete\\n' "$suite" >&2
printf 'finish %s\\n' "$suite" >> "$TEST_STATE/events"
touch "$TEST_STATE/$suite.finished"
exit "$result"
`,
          { mode: 0o755 },
        );
        const child = Bun.spawn(
          [
            process.platform === 'darwin' ? '/bin/bash' : 'bash',
            '-c',
            probe.run!,
          ],
          {
            cwd: directory,
            env: {
              PATH: `${directory}:${process.env.PATH}`,
              RUNNER_TEMP: `${directory}/logs with spaces`,
              TEST_STATE: directory,
              TEST_IMAGES_EXIT: String(imagesExit),
              TEST_RUNTIME_EXIT: String(runtimeExit),
              ...probe.env,
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(stderr).toBe('');
        expect(code).toBe(imagesExit === 0 && runtimeExit === 0 ? 0 : 1);
        expect(
          (await readFile(join(directory, 'calls'), 'utf8'))
            .trim()
            .split('\n')
            .toSorted(),
        ).toEqual(
          [
            `${imageSuite}|true|never|`,
            `${runtimeSuite}|true||tale-sandbox-runtime:latest`,
          ].toSorted(),
        );
        const events = (await readFile(join(directory, 'events'), 'utf8'))
          .trim()
          .split('\n');
        expect(events.slice(0, 2).toSorted()).toEqual([
          'start images',
          'start runtime',
        ]);
        expect(events.slice(2)).toEqual(['finish images', 'finish runtime']);
        expect(stdout).toBe(
          '::group::Container image validation\nimages stdout complete\nimages stderr complete\n::endgroup::\n' +
            '::group::Sandbox runtime conformance\nruntime stdout complete\nruntime stderr complete\n::endgroup::\n',
        );
        const [logsDirectory] = await readdir(
          join(directory, 'logs with spaces'),
        );
        expect(logsDirectory).toMatch(/^image-validation\.[^/]+$/);
        for (const suite of ['images', 'runtime']) {
          expect(
            await readFile(
              join(
                directory,
                'logs with spaces',
                logsDirectory!,
                `${suite}.log`,
              ),
              'utf8',
            ),
          ).toBe(`${suite} stdout complete\n${suite} stderr complete\n`);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
