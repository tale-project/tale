import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  const child = Bun.spawn(['bash', '-c', script], {
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
  },
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
    };
    expect((await execute(script, environment)).code).toBe(0);
    expect(
      (await execute(script, { ...environment, RUNNER_ARCH: 'ARM64' })).code,
    ).toBe(0);
    for (const changed of [
      { TALE_CLI_REVISION: 'main' },
      { TALE_CLI_REVISION: 'v1.2.3' },
      { TALE_CLI_REVISION: `${environment.TALE_CLI_REVISION}\n` },
      { RUNNER_OS: 'macOS' },
      { RUNNER_ARCH: 'X86' },
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
