import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants, runInNewContext } from 'node:vm';

import { parse } from 'yaml';

import {
  BUILD_FILTERS,
  CI_CONTEXTS,
  CI_JOBS,
  E2E_SERVICES,
  COMPOSE_SERVICES,
} from './ci-ready';
import { CANDIDATE_JOBS, IMAGE_SERVICES } from './release-candidate-gate';

const root = fileURLToPath(new URL('../../..', import.meta.url));
type Step = {
  id?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  name: string;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps?: Step[];
  strategy?: { matrix: Record<string, unknown> };
  'continue-on-error'?: boolean;
};
type Workflow = {
  on: Record<string, { paths?: string[]; types?: string[] } | null>;
  jobs: Record<string, Job>;
};
const yaml = async (relative: string) =>
  parse(await readFile(`${root}/${relative}`, 'utf8'));
const workflow = async (stem: string): Promise<Workflow> =>
  yaml(`.github/workflows/${stem}.yml`);
const actions = async (name: string): Promise<Step[]> =>
  (await yaml(`.github/actions/${name}/action.yml`)).runs.steps;

describe('seven complete native merge gates', () => {
  test('unique direct contexts cover every actual job, including explicit event-only lanes', async () => {
    const names: string[] = [];
    for (const [stem, expected] of Object.entries(CI_JOBS)) {
      const file = await workflow(stem);
      const gate = file.jobs['ci-ready']!;
      expect(gate.name).toBe(CI_CONTEXTS[stem as keyof typeof CI_CONTEXTS]);
      expect(gate.name).toMatch(
        /^CI ready \((Checks|Commitlint|SAST|Security|CLI|E2E|Build)\)$/,
      );
      names.push(gate.name);
      expect(gate.if).toBe(
        "always() && (github.event_name == 'pull_request' || github.event_name == 'merge_group')",
      );
      expect([gate.needs].flat().toSorted()).toEqual(
        Object.keys(file.jobs)
          .filter((id) => id !== 'ci-ready')
          .toSorted(),
      );
      expect([gate.needs].flat().toSorted()).toEqual([...expected].toSorted());
      expect(gate.permissions).toEqual({ contents: 'read' });
      expect(gate.steps?.map((step) => step.uses)).toEqual([
        expect.stringMatching(/^actions\/checkout@/),
        './.github/actions/ci-ready',
      ]);
      expect(gate.steps?.[0]?.with?.['persist-credentials']).toBe(false);
      expect(gate.steps?.[1]?.with).toEqual({
        workflow: stem,
        jobs: '${{ toJSON(needs) }}',
      });
      expect(file.on.pull_request?.paths).toBeUndefined();
      expect(file.on.pull_request?.types).toContain('ready_for_review');
      expect(Object.hasOwn(file.on, 'merge_group')).toBe(true);
      expect(file.jobs['candidate-gate']!.needs).toEqual(
        expect.arrayContaining(CANDIDATE_JOBS[stem]!.ids),
      );
      expect([file.jobs['candidate-gate']!.needs].flat()).not.toContain(
        'ci-ready',
      );
      expect([file.jobs['candidate-gate']!.needs].flat()).not.toContain(
        'pr-scope',
      );
      for (const [id, job] of Object.entries(file.jobs)) {
        if (stem === 'build' && id === 'vulnerability-scan')
          expect(job['continue-on-error']).toBe(true);
        else expect([undefined, false]).toContain(job['continue-on-error']);
      }
    }
    expect(new Set(names).size).toBe(7);
    const observed: string[] = [];
    for (const file of await readdir(`${root}/.github/workflows`)) {
      if (!/\.ya?ml$/.test(file)) continue;
      const source = (await yaml(`.github/workflows/${file}`)) as Workflow;
      for (const job of Object.values(source.jobs)) {
        if (names.includes(job.name)) observed.push(job.name);
      }
    }
    expect(observed.toSorted()).toEqual(names.toSorted());
    const turbo = JSON.parse(
      await readFile(`${root}/tools/cli/turbo.json`, 'utf8'),
    );
    expect(turbo.tasks.test.inputs).toEqual(
      expect.arrayContaining([
        '$TURBO_ROOT$/.github/workflows/*.yml',
        '$TURBO_ROOT$/.github/workflows/*.yaml',
      ]),
    );
    const body = await readFile(
      `${root}/.github/actions/ci-ready/action.yml`,
      'utf8',
    );
    expect(body).not.toMatch(
      /setup-turbo|bun install|npm install|gh api|github\.rest|setInterval|setTimeout/,
    );
    expect(body).toContain('process.env.GITHUB_RUN_ATTEMPT');
    expect(body).toContain('context.sha');
    expect(body).toContain('core.setFailed');
  });

  test('all current native matrix legs and fork/advisory dispositions survive', async () => {
    const build = await workflow('build');
    expect(build.jobs.build!.strategy?.matrix.service).toEqual(IMAGE_SERVICES);
    expect<readonly string[]>(COMPOSE_SERVICES).toEqual(IMAGE_SERVICES);
    const checks = await workflow('checks');
    expect(checks.jobs['test-platform-shards']!.strategy?.matrix.shard).toEqual(
      [1, 2],
    );
    expect(checks.jobs.test!.needs).toEqual([
      'candidate-source',
      'test-platform-shards',
      'test-workspaces',
    ]);
    expect(checks.jobs['test-ui-shards']!.strategy?.matrix.shard).toEqual([
      1, 2, 3, 4,
    ]);
    expect(checks.jobs['test-ui']!.needs).toContain('test-ui-shards');
    const e2e = await workflow('e2e');
    expect(e2e.jobs.e2e!.strategy?.matrix.shard).toEqual(
      Array.from({ length: 4 }, (_, i) => i + 1),
    );
    expect(e2e.jobs['static-sites']!.strategy?.matrix.service).toBe(
      '${{ fromJSON(needs.scope.outputs.static_services) }}',
    );
    expect(e2e.jobs.scope!.name).toBe('E2E scope');
    const cli = await workflow('cli');
    expect(
      (cli.jobs.build!.strategy!.matrix.include as { platform: string }[]).map(
        (leg) => leg.platform,
      ),
    ).toEqual(['linux', 'linux-arm64', 'macos', 'macos-x64', 'windows']);
    for (const id of ['smoke-test', 'image-validate']) {
      expect(build.jobs[id]!.if).toContain(
        'github.event.pull_request.head.repo.fork != true',
      );
      expect(build.jobs[`${id}-fork`]!.if).toContain(
        'github.event.pull_request.head.repo.fork == true',
      );
    }
    expect(build.jobs['vulnerability-scan']!['continue-on-error']).toBe(true);
    expect(cli.jobs.release!.if).toContain(
      "github.event_name == 'workflow_dispatch'",
    );
  });

  test('E2E exports the frozen discovery into the existing native scope producer', async () => {
    const file = await workflow('e2e');
    const scope = file.jobs.scope!;
    expect(
      scope.steps?.some((step) => step.uses?.startsWith('dorny/paths-filter')),
    ).toBe(false);
    const decide = scope.steps?.find((step) => step.id === 'decide');
    expect(E2E_SERVICES).toEqual(['platform', 'web', 'docs']);
    expect(decide?.env).toEqual({
      EVENT_NAME: '${{ github.event_name }}',
      ...Object.fromEntries(
        E2E_SERVICES.map((name) => [
          name.toUpperCase(),
          '${{ needs.pr-scope.outputs.' + name + ' }}',
        ]),
      ),
    });
    for (const id of ['build', 'static-sites']) {
      expect([file.jobs[id]!.needs].flat()).toContain('scope');
      expect(file.jobs[id]!.if).toContain("needs.scope.result == 'success'");
    }
    expect([file.jobs.e2e!.needs].flat()).toContain('build');
  });

  test('scope lifts the existing PR path policy without changing push filters', async () => {
    const filters = (await yaml('.github/ci-scope.yml')) as Record<
      string,
      string[]
    >;
    for (const stem of ['build', 'cli', 'security']) {
      const file = await workflow(stem);
      expect(filters[stem]).toEqual(file.on.push?.paths ?? []);
    }
    expect(filters.e2e).toEqual([
      'services/platform/**',
      'services/web/**',
      'services/docs/**',
      'packages/**',
      'configs/platform/**',
      'services/sandbox-runtime/daemon/**',
      'tools/cli/**',
      'scripts/**',
      'compose*.yml',
      'docs/**',
      'patches/**',
      '.github/workflows/e2e.yml',
      '.github/actions/setup-turbo/**',
      'package.json',
      'bun.lock',
      'bunfig.toml',
      'turbo.json',
      'tsconfig*.json',
    ]);
    expect(filters.all).toEqual(['**']);
    expect(filters.guard).toContain('.github/ci-scope.yml');
    expect(filters.guard).toContain('.github/actions/ci-scope/**');
    expect(filters.guard).toContain('tools/cli/scripts/ci-ready.ts');
    for (const stem of ['build', 'cli', 'security', 'e2e']) {
      const file = await workflow(stem);
      const scope = file.jobs['pr-scope']!;
      expect(scope.if).toBe("github.event_name == 'pull_request'");
      expect(scope.permissions).toEqual({
        contents: 'read',
        'pull-requests': 'read',
      });
      expect(scope.steps?.find((step) => step.id === 'scope')?.with).toEqual({
        filter: stem,
      });
      const roots = {
        build: ['changes'],
        cli: ['prepare', 'build'],
        security: ['bun-audit', 'trivy-fs'],
        e2e: ['scope'],
      }[stem]!;
      for (const id of roots) {
        expect([file.jobs[id]!.needs].flat()).toContain('pr-scope');
        expect(file.jobs[id]!.if).toContain(
          "needs.pr-scope.result == 'success' && needs.pr-scope.outputs.run == 'true'",
        );
      }
    }
    const checks = await workflow('checks');
    expect(
      checks.jobs['integration-scope']?.steps?.find(
        (step) => step.id === 'decide',
      )?.uses,
    ).toBe('./.github/actions/ci-scope');
    for (const unit of ['tools/cli', 'services/platform']) {
      const turbo = await yaml(`${unit}/turbo.json`);
      expect(turbo.tasks.test.inputs).toContain(
        '$TURBO_ROOT$/.github/ci-scope.yml',
      );
    }
  });
});

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const pr = () => ({
  number: 1,
  base: { sha: A },
  head: { sha: B },
  changed_files: 2,
});
async function execute(
  step: Step,
  payload: unknown,
  eventName: string,
  env: Record<string, string>,
  answer: unknown,
) {
  const outputs: Record<string, string> = {};
  let calls = 0;
  // Execute repository-owned action source with fixture API/environment objects.
  await runInNewContext(
    `(async () => { ${step.with?.script} })()`,
    {
      core: {
        setOutput: (name: string, value: string) => {
          outputs[name] = value;
        },
        info: () => {},
      },
      github: {
        rest: {
          pulls: {
            get: async () => {
              calls++;
              if (answer instanceof Error) throw answer;
              return { data: answer };
            },
          },
        },
      },
      context: { eventName, payload, repo: { owner: 'test', repo: 'test' } },
      require: (specifier: string) => {
        if (specifier !== 'node:url') throw new Error('Unexpected require');
        return { pathToFileURL };
      },
      process: { env: { GITHUB_WORKSPACE: root, ...env } },
    },
    {
      timeout: 1000,
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    },
  );
  return { outputs, calls };
}

describe('actual scope action boundaries', () => {
  test('E2E service decisions use the same frozen identity and refuse incomplete discovery', async () => {
    const decide = (await actions('ci-scope'))[2]!;
    const env = {
      SCOPE_FILTER: 'e2e',
      SCOPE_FULL: 'false',
      SCOPE_BEFORE: JSON.stringify(pr()),
      SCOPE_TOUCHED: 'true',
      SCOPE_GUARD: 'false',
      SCOPE_COUNT: '2',
      SCOPE_FILES: '["services/web/a.ts","README.md"]',
      SCOPE_ADDED: 'false',
      SCOPE_DELETED: 'false',
      E2E_platform: 'false',
      E2E_web: 'true',
      E2E_docs: 'false',
    };
    expect(
      (await execute(decide, { pull_request: pr() }, 'pull_request', env, pr()))
        .outputs,
    ).toEqual({
      platform: 'false',
      web: 'true',
      docs: 'false',
      run: 'true',
      full: 'false',
    });
    expect(
      (
        await execute(decide, { pull_request: pr() }, 'pull_request', env, {
          ...pr(),
          head: { sha: A },
        })
      ).outputs,
    ).toEqual({
      platform: 'true',
      web: 'true',
      docs: 'true',
      run: 'true',
      full: 'true',
    });
    await expect(
      execute(
        decide,
        { pull_request: pr() },
        'pull_request',
        { ...env, E2E_docs: '' },
        pr(),
      ),
    ).rejects.toThrow();
    await expect(
      execute(
        decide,
        { pull_request: pr() },
        'pull_request',
        { ...env, SCOPE_COUNT: '1' },
        pr(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await execute(
          decide,
          {},
          'merge_group',
          { SCOPE_FILTER: 'e2e', SCOPE_FULL: 'true' },
          null,
        )
      ).outputs,
    ).toEqual({
      platform: 'true',
      web: 'true',
      docs: 'true',
      run: 'true',
      full: 'true',
    });
  });

  test('Build exports one validated immutable service decision and widens source movement', async () => {
    const decide = (await actions('ci-scope'))[2]!;
    const env = {
      SCOPE_FILTER: 'build',
      SCOPE_FULL: 'false',
      SCOPE_BEFORE: JSON.stringify(pr()),
      SCOPE_TOUCHED: 'true',
      SCOPE_GUARD: 'false',
      SCOPE_COUNT: '2',
      SCOPE_FILES: '["services/platform/a.ts","README.md"]',
      SCOPE_ADDED: 'false',
      SCOPE_DELETED: 'false',
      ...Object.fromEntries(
        BUILD_FILTERS.map((name) => [
          `BUILD_${name.replaceAll('-', '_')}`,
          name === 'platform' || name === 'ci_tests' ? 'true' : 'false',
        ]),
      ),
    };
    const result = await execute(
      decide,
      { pull_request: pr() },
      'pull_request',
      env,
      pr(),
    );
    expect(result.outputs).toEqual({
      changes: '["platform","ci_tests"]',
      ci_tests: 'true',
      storybook: 'false',
      run: 'true',
      full: 'false',
    });
    expect(result.calls).toBe(1);
    const shared = await execute(
      decide,
      { pull_request: pr() },
      'pull_request',
      { ...env, BUILD_image_inputs: 'true' },
      pr(),
    );
    expect(shared.calls).toBe(1);
    expect(shared.outputs).toEqual({
      changes: JSON.stringify(
        BUILD_FILTERS.filter((name) => name !== 'image_inputs'),
      ),
      ci_tests: 'true',
      storybook: 'true',
      run: 'true',
      full: 'false',
    });
    const moved = await execute(
      decide,
      { pull_request: pr() },
      'pull_request',
      env,
      { ...pr(), head: { sha: A } },
    );
    expect(JSON.parse(moved.outputs.changes!)).toEqual(
      BUILD_FILTERS.filter((name) => name !== 'image_inputs'),
    );
    expect(moved.outputs.full).toBe('true');
    await expect(
      execute(
        decide,
        { pull_request: pr() },
        'pull_request',
        { ...env, BUILD_platform: '' },
        pr(),
      ),
    ).rejects.toThrow();
  });

  test('preflight freezes only identity data and handles PR/merge-group/candidate events', async () => {
    const before = (await actions('ci-scope'))[0]!;
    const current = { ...pr(), body: 'not part of the scope identity' };
    const result = await execute(
      before,
      { pull_request: pr() },
      'pull_request',
      {},
      current,
    );
    expect(result.calls).toBe(1);
    expect(result.outputs.full).toBe('false');
    expect(JSON.parse(result.outputs.identity!)).toEqual({
      base: { sha: A },
      head: { sha: B },
      changed_files: 2,
    });
    for (const event of [
      'merge_group',
      'repository_dispatch',
      'push',
      'schedule',
      'workflow_dispatch',
    ]) {
      expect(await execute(before, {}, event, {}, null)).toEqual({
        calls: 0,
        outputs: { full: 'true' },
      });
    }
    await expect(execute(before, {}, 'unknown', {}, null)).rejects.toThrow();
    await expect(
      execute(
        before,
        { pull_request: pr() },
        'pull_request',
        {},
        new Error('API unavailable'),
      ),
    ).rejects.toThrow('API unavailable');
  });

  test('postflight preserves valid false and widens a branch that moved during filtering', async () => {
    const decide = (await actions('ci-scope'))[2]!;
    const env = {
      SCOPE_FILTER: 'integration',
      SCOPE_FULL: 'false',
      SCOPE_BEFORE: JSON.stringify(pr()),
      SCOPE_TOUCHED: 'false',
      SCOPE_GUARD: 'false',
      SCOPE_COUNT: '2',
      SCOPE_FILES: '["README.md","LICENSE"]',
      SCOPE_ADDED: 'false',
      SCOPE_DELETED: 'false',
    };
    expect(
      (await execute(decide, { pull_request: pr() }, 'pull_request', env, pr()))
        .outputs,
    ).toEqual({ run: 'false', full: 'false' });
    const moved = { ...pr(), head: { sha: A } };
    expect(
      (
        await execute(
          decide,
          { pull_request: pr() },
          'pull_request',
          env,
          moved,
        )
      ).outputs,
    ).toEqual({ run: 'true', full: 'true' });
    await expect(
      execute(
        decide,
        { pull_request: pr() },
        'pull_request',
        { ...env, SCOPE_TOUCHED: '' },
        pr(),
      ),
    ).rejects.toThrow();
    await expect(
      execute(
        decide,
        { pull_request: pr() },
        'pull_request',
        env,
        new Error('API unavailable'),
      ),
    ).rejects.toThrow();
    expect(
      (
        await execute(
          decide,
          {},
          'merge_group',
          { ...env, SCOPE_FULL: 'true' },
          null,
        )
      ).outputs,
    ).toEqual({ run: 'true', full: 'true' });
  });
});
