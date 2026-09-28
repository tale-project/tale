import { afterEach, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

type Step = {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function execute(
  script: string | undefined,
  environment: Record<string, string>,
) {
  if (!script) throw new Error('Deployment CI script is missing');
  const root = await mkdtemp(join(tmpdir(), 'tale-deployment-ci-'));
  roots.push(root);
  const output = join(root, 'output');
  await writeFile(output, '');
  // macOS still ships Bash 3.2. Its errexit behavior differs for a bare
  // failed [[ condition ]], so exercise that supported shell explicitly.
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-c', script], {
    cwd: root,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...environment },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr, output: await readFile(output, 'utf8') };
}

test.skipIf(process.platform === 'win32')(
  'actual image publication script uses complete source identity for main and PR tags',
  async () => {
    const workflow = parse(
      await readFile(join(repository, '.github/workflows/build.yml'), 'utf8'),
    ) as { jobs: { changes: { steps: Step[] } } };
    const script = workflow.jobs.changes.steps.find(
      (step) => step.id === 'tag',
    )?.run;
    const revision = '1234567890abcdef1234567890abcdef12345678';
    for (const pr of ['', '913']) {
      const result = await execute(script, {
        GITHUB_SHA: revision,
        PR_NUMBER: pr,
      });
      expect(result.code).toBe(0);
      expect(result.output).toBe(
        `value=${pr ? `pr-${pr}-` : ''}sha-${revision}\n`,
      );
    }
    for (const sha of ['main', revision.slice(0, 7), `${revision}\n`, '']) {
      const result = await execute(script, { GITHUB_SHA: sha, PR_NUMBER: '' });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe('');
    }
    for (const pr of ['913\n', 'branch', '913; exit 0']) {
      const result = await execute(script, {
        GITHUB_SHA: revision,
        PR_NUMBER: pr,
      });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe('');
    }
  },
);

test('PR-image cleanup covers exactly the images the build job publishes', async () => {
  // Only the build job pushes `pr-N-sha-` tags. A service it no longer builds
  // has no package left to clean (convex and controller, 2026-09); one it
  // builds but the cleanup skips leaks a tag on every push.
  const services = async (name: string, job: string) => {
    const workflow = parse(
      await readFile(join(repository, '.github/workflows', name), 'utf8'),
    ) as {
      jobs: Record<
        string,
        { strategy?: { matrix?: { service?: string[] } } } | undefined
      >;
    };
    return workflow.jobs[job]?.strategy?.matrix?.service?.toSorted() ?? [];
  };
  const built = await services('build.yml', 'build');
  expect(built).toContain('platform');
  expect(await services('cleanup-pr-images.yml', 'delete')).toEqual(built);
});

/** A stand-in for the `gh` the cleanup step runs. It logs each call, then
 * answers with the next reply of the listing or the deletion queue: `ok`, or
 * the HTTP status the call fails with, in gh's own error format. A listing
 * that succeeds prints the page through the step's own `--jq` filter. */
const GH_STAND_IN = `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG"
if [ "$2" = -X ]; then
  replies=$TEST_DELETE_REPLIES
  call=$(grep -c '^api -X DELETE ' "$TEST_COMMAND_LOG")
else
  replies=$TEST_LIST_REPLIES
  call=$(grep -c ' --paginate ' "$TEST_COMMAND_LOG")
fi
reply=$(printf '%s\\n' $replies | sed -n "\${call}p")
case "$reply" in
  ok) ;;
  '') echo "gh: unexpected call: $*" >&2; exit 2 ;;
  *) echo "gh: Stand-in failure. (HTTP $reply)" >&2; exit 1 ;;
esac
[ "$2" = -X ] && exit 0
while [ $# -gt 1 ]; do
  [ "$1" = --jq ] && filter=$2
  shift
done
jq -r "$filter" "$TEST_VERSIONS"
`;

/** Runs the PR-image cleanup step's script for PR 7 against the stand-in. */
async function cleanup(
  service: string,
  replies: { list: string[]; remove?: string[] },
  versions: unknown[] = [],
) {
  const workflow = parse(
    await readFile(
      join(repository, '.github/workflows/cleanup-pr-images.yml'),
      'utf8',
    ),
  ) as { jobs: { delete: { steps: Step[] } } };
  const root = await mkdtemp(join(tmpdir(), 'tale-cleanup-pr-images-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const log = join(root, 'calls');
  const summary = join(root, 'summary');
  const page = join(root, 'versions.json');
  await mkdir(bin);
  await writeFile(log, '');
  await writeFile(summary, '');
  await writeFile(page, JSON.stringify(versions));
  await writeFile(join(bin, 'gh'), GH_STAND_IN, { mode: 0o755 });
  // The retry backoff (2 s, then 4 s) would only slow the suite down.
  await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const result = await execute(
    workflow.jobs.delete.steps.find(
      (step) => step.name === 'Delete PR-tagged versions',
    )?.run,
    {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_STEP_SUMMARY: summary,
      TEST_COMMAND_LOG: log,
      TEST_LIST_REPLIES: replies.list.join(' '),
      TEST_DELETE_REPLIES: (replies.remove ?? []).join(' '),
      TEST_VERSIONS: page,
      PR: '7',
      SVC: service,
      OWNER: 'tale-project',
    },
  );
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  return {
    ...result,
    summary: await readFile(summary, 'utf8'),
    listings: calls.filter((call) => call.includes(' --paginate ')).length,
    deletions: calls
      .filter((call) => call.startsWith('api -X DELETE '))
      .map((call) => call.split(' ')[3]?.split('/').at(-1)),
  };
}

test.skipIf(process.platform === 'win32')(
  'PR-image cleanup finds nothing to clean in a package that does not exist',
  async () => {
    const result = await cleanup('convex', { list: ['404'] });
    expect(result.code, result.stdout + result.stderr).toBe(0);
    // A 404 is an answer, not a blip: one listing, no retry.
    expect(result.listings).toBe(1);
    expect(result.deletions).toEqual([]);
    // The matrix tracks build.yml, so a 404 names the two causes left: an
    // image never pushed, or a package this repository lost access to.
    expect(result.stdout).toContain(
      '::warning::Package tale-convex not found or not visible to this token (HTTP 404)',
    );
    expect(result.stdout).toContain('Manage Actions access');
    expect(result.summary).toContain(
      'package tale-convex was not found or is not visible to this token; no versions cleaned',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  'PR-image cleanup retries a failed listing and fails the job when the error persists',
  async () => {
    const recovered = await cleanup('platform', { list: ['502', 'ok'] });
    expect(recovered.code, recovered.stdout + recovered.stderr).toBe(0);
    expect(recovered.listings).toBe(2);
    expect(recovered.summary).toContain('No `pr-7-sha-*` versions found');
    const refused = await cleanup('platform', { list: ['403', '403', '403'] });
    expect(refused.code).toBe(1);
    expect(refused.listings).toBe(3);
    // gh's own error still reaches the job log.
    expect(refused.stderr).toContain('(HTTP 403)');
    expect(refused.stdout).toContain(
      '::error::Failed to list versions of tale%2Ftale-platform after 3 attempts',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  "PR-image cleanup deletes only the closed PR's tags",
  async () => {
    const version = (id: number, ...tags: string[]) => ({
      id,
      metadata: { container: { tags } },
    });
    const result = await cleanup(
      'platform',
      { list: ['ok'], remove: ['ok', '404'] },
      [
        version(1, `pr-7-sha-${'a'.repeat(40)}`),
        version(2, `pr-70-sha-${'a'.repeat(40)}`),
        version(3, `sha-${'a'.repeat(40)}`),
        version(4),
        version(5, `pr-7-sha-${'b'.repeat(40)}`),
      ],
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.deletions).toEqual(['1', '5']);
    // A version gone before its delete (a duplicate run, say) is no failure.
    expect(result.summary).toContain(
      '- Deleted: 1\n- Already gone (404): 1\n- Failures: 0',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  'setup action selects the host binary, honours linux-baseline on x64 only and seals only the final Mac executable',
  async () => {
    const action = parse(
      await readFile(
        join(repository, '.github/actions/setup-cli/action.yml'),
        'utf8',
      ),
    ) as { runs: { steps: Step[] } };
    const script = action.runs.steps.find((step) => step.id === 'build')?.run;
    if (!script) throw new Error('Setup build script missing');
    // Without a build script, the runner/baseline pair is one the step refuses.
    const cases: Array<[string, string, string, string?]> = [
      ['Linux', 'X64', 'false', 'build:linux'],
      ['Linux', 'X64', 'true', 'build:linux-baseline'],
      ['Linux', 'ARM64', 'false', 'build:linux-arm64'],
      ['Linux', 'ARM64', 'true'],
      ['macOS', 'ARM64', 'false', 'build:mac'],
      ['macOS', 'ARM64', 'true'],
    ];
    for (const [os, arch, baseline, build] of cases) {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), 'tale-setup-build-')),
      );
      roots.push(root);
      const bin = join(root, 'bin');
      const log = join(root, 'commands');
      const output = join(root, 'output');
      const path = join(root, 'path');
      await mkdir(bin);
      await mkdir(join(root, 'tools/cli/dist'), { recursive: true });
      await writeFile(log, '');
      await writeFile(output, '');
      await writeFile(path, '');
      await writeFile(
        join(bin, 'git'),
        '#!/bin/sh\nif [ "$1" = rev-parse ]; then printf "%s\\n" "$TALE_CLI_REVISION"; fi\n',
        { mode: 0o755 },
      );
      for (const command of ['bun', 'codesign'])
        await writeFile(
          join(bin, command),
          `#!/bin/sh\nprintf '%s\\n' '${command}'" $*" >> "$TEST_COMMAND_LOG"\n`,
          { mode: 0o755 },
        );
      await writeFile(
        join(root, 'tools/cli/dist/tale'),
        '#!/bin/sh\nexit 0\n',
        { mode: 0o755 },
      );
      const child = Bun.spawn(
        [process.platform === 'darwin' ? '/bin/bash' : 'bash', '-c', script],
        {
          cwd: root,
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_OUTPUT: output,
            GITHUB_PATH: path,
            TEST_COMMAND_LOG: log,
            RUNNER_OS: os,
            RUNNER_ARCH: arch,
            TALE_CLI_REVISION: 'a'.repeat(40),
            TALE_CLI_LINUX_BASELINE: baseline,
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
      const calls = (await readFile(log, 'utf8')).trim().split('\n');
      if (!build) {
        expect(code, stdout + stderr).not.toBe(0);
        expect(stdout).toContain('::error::');
        expect(calls.some((call) => call.includes(' build:'))).toBe(false);
        expect(await readFile(output, 'utf8')).toBe('');
        continue;
      }
      expect(code, stdout + stderr).toBe(0);
      expect(calls).toContain(`bun run --filter @tale/cli ${build}`);
      // Every supported runner also ships the interpreted bundle the
      // backend-local provision phase runs under the target's own bun.
      expect(calls).toContain('bun run --filter @tale/cli build:backend-local');
      expect(calls.filter((call) => call.startsWith('codesign'))).toEqual(
        os === 'macOS'
          ? [
              'codesign --remove-signature tools/cli/dist/tale',
              'codesign -s - tools/cli/dist/tale',
              'codesign --verify --strict --verbose=2 tools/cli/dist/tale',
            ]
          : [],
      );
      expect(calls.at(-1)).toBe('bun run --filter @tale/cli check:bundle');
      expect(await readFile(output, 'utf8')).toBe(
        `executable=${root}/tools/cli/dist/tale\n`,
      );
    }
  },
  30_000,
);

test.skipIf(process.platform === 'win32')(
  'setup action rejects mutable pins and unsupported runners before checkout or build',
  async () => {
    const action = parse(
      await readFile(
        join(repository, '.github/actions/setup-cli/action.yml'),
        'utf8',
      ),
    ) as { runs: { steps: Step[] } };
    const steps = action.runs.steps;
    const script = steps[0]?.run;
    const environment = {
      TALE_CLI_REVISION: 'a'.repeat(40),
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
      TALE_CLI_LINUX_BASELINE: 'false',
    };
    expect((await execute(script, environment)).code).toBe(0);
    expect(
      (await execute(script, { ...environment, RUNNER_ARCH: 'ARM64' })).code,
    ).toBe(0);
    expect(
      (
        await execute(script, {
          ...environment,
          RUNNER_OS: 'macOS',
          RUNNER_ARCH: 'ARM64',
        })
      ).code,
    ).toBe(0);
    expect(
      (
        await execute(script, {
          ...environment,
          TALE_CLI_LINUX_BASELINE: 'true',
        })
      ).code,
    ).toBe(0);
    const refused = await execute(script, {
      ...environment,
      TALE_CLI_LINUX_BASELINE: 'true',
      RUNNER_ARCH: 'ARM64',
    });
    expect(refused.code).not.toBe(0);
    expect(refused.stdout).toContain(
      '::error::Tale setup linux-baseline requires a Linux x64 runner',
    );
    for (const changed of [
      { TALE_CLI_REVISION: 'main' },
      { TALE_CLI_REVISION: 'v1.2.3' },
      { TALE_CLI_REVISION: `${environment.TALE_CLI_REVISION}\n` },
      { RUNNER_OS: 'Windows' },
      { RUNNER_OS: 'macOS', RUNNER_ARCH: 'X64' },
      { RUNNER_ARCH: 'X86' },
      {
        TALE_CLI_LINUX_BASELINE: 'true',
        RUNNER_OS: 'macOS',
        RUNNER_ARCH: 'ARM64',
      },
      { TALE_CLI_LINUX_BASELINE: 'yes' },
    ]) {
      expect(
        (await execute(script, { ...environment, ...changed })).code,
      ).not.toBe(0);
    }
    const checkout = steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout?.with).toMatchObject({
      repository: 'tale-project/tale',
      ref: '${{ inputs.revision }}',
      'persist-credentials': false,
    });
    expect(steps.find((step) => step.id === 'build')?.run).toContain(
      'git status --porcelain --untracked-files=all',
    );
  },
);
