import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import picomatch from 'picomatch';
import { parse } from 'yaml';

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};
type Job = {
  if?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  strategy?: { matrix?: { service?: string[] } };
};
type Workflow = {
  on: {
    push: { paths: string[] };
    pull_request?: { paths: string[] };
  };
  jobs: Record<string, Job>;
};
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const standaloneServices = ['web', 'docs', 'ui-docs', 'ai-gateway'];
const standaloneHarnesses = standaloneServices.map(
  (service) =>
    `services/platform/tests/integration/container-${service}-test.ts`,
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const workflow = async (name = 'build.yml') =>
  parse(
    await readFile(join(repository, '.github/workflows', name), 'utf8'),
  ) as Workflow;
// Thousands of boundary probes use the same fixed deployed patterns. Compile
// each once without changing paths-filter's dot:true/default OR semantics.
const compiledPatterns = new Map<string, ReturnType<typeof picomatch>>();
const matches = (patterns: string[], path: string) =>
  patterns.some((pattern) => {
    let compiled = compiledPatterns.get(pattern);
    if (!compiled) {
      compiled = picomatch(pattern, { dot: true });
      compiledPatterns.set(pattern, compiled);
    }
    return compiled(path);
  });
const filtersOf = async (build: Workflow) => {
  const source = String(
    build.jobs.changes?.steps?.find((step) => step.name === 'Filter paths')
      ?.with?.filters,
  );
  const policies = parse(
    await readFile(join(repository, source), 'utf8'),
  ) as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(policies)
      .filter(([name]) => name.startsWith('build_'))
      .map(([name, patterns]) => [name.slice(6), patterns]),
  );
};

async function plan(build: Workflow, paths: string[], candidate = '') {
  const root = await mkdtemp(join(tmpdir(), 'tale-build-scope-'));
  roots.push(root);
  const output = join(root, 'output');
  await writeFile(output, '');
  const filters = await filtersOf(build);
  const changed = Object.entries(filters)
    .filter(([, patterns]) => paths.some((path) => matches(patterns, path)))
    .map(([name]) => name);
  const script = build.jobs.changes?.steps?.find(
    (step) => step.name === 'Compute service matrix',
  )?.run;
  if (!script) throw new Error('Build service planner is missing');
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-c', script], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      CANDIDATE_SHA: candidate,
      EVENT_NAME: 'push',
      FULL_SCOPE: 'false',
      CHANGES: JSON.stringify(changed.map((name) => `build_${name}`)),
      CI_TESTS: String(changed.includes('ci_tests')),
      STORYBOOK: String(changed.includes('storybook')),
      IMAGE_INPUTS: String(changed.includes('image_inputs')),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
  return Object.fromEntries(
    (await readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

describe('container build boundaries', () => {
  test('scope matching retains the pinned action default and exact matcher version', async () => {
    const build = await workflow();
    const filter = build.jobs.changes!.steps!.find(
      (step) => step.name === 'Filter paths',
    )!;
    expect(filter.uses).toBe(
      'dorny/paths-filter@fbd0ab8f3e69293af611ebaee6363fc25e6d187d',
    );
    expect(filter.with?.['predicate-quantifier'] ?? 'some').toBe('some');
    const manifest = JSON.parse(
      await readFile(join(repository, 'tools/cli/package.json'), 'utf8'),
    ) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies.picomatch).toBe('2.3.2');
    expect(manifest.devDependencies['@types/picomatch']).toBe('2.3.4');
  });

  test('standalone harnesses are isolated entry points outside platform Docker contexts', async () => {
    const build = await workflow();
    const filters = await filtersOf(build);
    expect(
      (await readFile(join(repository, '.dockerignore'), 'utf8')).split(
        /\r?\n/,
      ),
    ).toContain('services/platform/tests/');
    for (const [index, harness] of standaloneHarnesses.entries()) {
      expect(matches(filters[standaloneServices[index]!]!, harness)).toBe(true);
      for (const scope of ['platform', 'ci_tests'])
        expect(matches(filters[scope]!, harness), `${scope}: ${harness}`).toBe(
          false,
        );
      const contents = await readFile(join(repository, harness), 'utf8');
      const imports = [...contents.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
      );
      expect(imports, harness).toEqual(['./static-site-test']);
      expect(contents, harness).toContain(
        `name: '${standaloneServices[index]}',`,
      );
    }
    for (const patterns of Object.values(filters))
      expect(patterns.some((pattern) => pattern.startsWith('!'))).toBe(false);
  });

  test('neighboring names and shared container harnesses retain platform validation', async () => {
    const filters = await filtersOf(await workflow());
    const paths = [
      'services/platform/.scope-probe',
      'services/platform/backend/server.ts',
      'services/platform/tests/integration/container-smoke-test.ts',
      'services/platform/tests/integration/container-image-test.ts',
      'services/platform/tests/integration/container-sandbox-runtime-test.ts',
      'services/platform/tests/integration/container-vulnerability-scan.ts',
      'services/platform/tests/integration/static-site-test.ts',
      'services/platform/tests/integration/lib/docker.ts',
      'services/platform/tests/integration/lib/.fixture',
      ...standaloneHarnesses.flatMap((path) => {
        const separator = path.lastIndexOf('/');
        const directory = path.slice(0, separator);
        const name = path.slice(separator + 1);
        return [
          `${directory}/prefix-${name}`,
          `${path}.bak`,
          path.replace('.ts', '-extra.ts'),
          `${directory}/nested/${name}`,
          `${path}/nested.ts`,
        ];
      }),
    ];
    for (const path of paths)
      for (const scope of ['platform', 'ci_tests'])
        expect(matches(filters[scope]!, path), `${scope}: ${path}`).toBe(true);
    for (const scope of ['platform', 'ci_tests'])
      expect(matches(filters[scope]!, 'unrelated/example.ts')).toBe(false);
  });

  describe.skipIf(process.platform === 'win32')(
    'standalone harness plans',
    () => {
      test.each(standaloneServices)(
        '%s harness selects its own image while mixed source edits keep the stack',
        async (service) => {
          const build = await workflow();
          const harness = `services/platform/tests/integration/container-${service}-test.ts`;
          const isolated = await plan(build, [harness]);
          expect(JSON.parse(isolated.list!)).toEqual([service]);
          expect(isolated.stack).toBe('false');
          expect(isolated.ci_tests).toBe('false');
          // Storybook uses the full checkout's automatic Tailwind scanner.
          expect(isolated.storybook).toBe('true');
          const mixed = await plan(build, [
            harness,
            'services/platform/backend/server.ts',
          ]);
          expect(JSON.parse(mixed.list!).toSorted()).toEqual(
            ['platform', service].toSorted(),
          );
          expect(mixed.stack).toBe('true');
          expect(mixed.ci_tests).toBe('true');
        },
      );

      test('candidate-only harness edits still validate every image and gate', async () => {
        const build = await workflow();
        const candidate = await plan(
          build,
          standaloneHarnesses,
          '1234567890abcdef1234567890abcdef12345678',
        );
        const expected = Object.keys(await filtersOf(build)).filter(
          (name) => !['image_inputs', 'ci_tests', 'storybook'].includes(name),
        );
        expect(JSON.parse(candidate.list!).toSorted()).toEqual(
          expected.toSorted(),
        );
        expect(candidate.stack).toBe('true');
        expect(candidate.ci_tests).toBe('true');
        expect(candidate.storybook).toBe('true');
      });
    },
  );

  test.skipIf(process.platform === 'win32')(
    'every Dockerfile COPY source is covered by its service or common input scope',
    async () => {
      const build = await workflow();
      const filters = await filtersOf(build);
      const stackInputs = new Set<string>();
      for (const service of [
        ...build.jobs.build!.strategy!.matrix!.service!,
        'web',
        'docs',
        'ui-docs',
        'ai-gateway',
      ]) {
        const dockerfile = (
          await readFile(
            join(repository, 'services', service, 'Dockerfile'),
            'utf8',
          )
        ).replaceAll(/\\\r?\n\s*/g, ' ');
        const scopes = [...filters[service]!, ...filters.image_inputs!];
        for (const line of dockerfile.split('\n')) {
          if (!line.startsWith('COPY ') || line.includes('--from=')) continue;
          const sources = line
            .split(/\s+/)
            .slice(1, -1)
            .filter((word) => !word.startsWith('--'));
          expect(sources.length, line).toBeGreaterThan(0);
          for (const source of sources) {
            // A directory COPY owns every descendant, not only the directory name.
            const path =
              source.endsWith('/') || !source.split('/').at(-1)!.includes('.')
                ? `${source.replace(/\/$/, '')}/__scope_probe__`
                : source;
            expect(matches(scopes, path), `${service}: ${source}`).toBe(true);
            expect(matches(build.on.push.paths, path), `push: ${source}`).toBe(
              true,
            );
            if (
              build.jobs.build!.strategy!.matrix!.service!.includes(service)
            ) {
              stackInputs.add(path);
            }
          }
        }
      }
      for (const path of stackInputs)
        expect((await plan(build, [path])).stack, `stack: ${path}`).toBe(
          'true',
        );
    },
  );

  test('GHA export lookups use the repository API token without unsupported import parameters', async () => {
    const build = await workflow();
    expect(build.jobs.build!.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      packages: 'write',
    });
    const image = build.jobs.build!.steps!.find(
      (step) => step.name === 'Build and push',
    )!;
    expect(image.with?.['cache-from']).toBe(
      'type=gha,scope=${{ matrix.service }}',
    );
    expect(image.with?.['cache-to']).toBe(
      "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && format('type=gha,scope={0},mode=max,ghtoken={1},repository={2}', matrix.service, secrets.GITHUB_TOKEN, github.repository) || '' }}",
    );
  });

  test('release layers use architecture-separated caches that PR builds cannot write', async () => {
    const release = await workflow('release.yml');
    const image = release.jobs.build!.steps!.find(
      (step) => step.name === 'Build and push',
    )!;
    const cache =
      'type=registry,ref=${{ env.REGISTRY }}/${{ github.repository }}/tale-${{ matrix.service.name }}-buildcache:${{ matrix.arch.name }}';
    expect(String(image.with?.['cache-from']).trim().split('\n')).toEqual([
      cache,
      "${{ matrix.arch.name == 'amd64' && format('type=gha,scope={0}', matrix.service.name) || '' }}",
    ]);
    expect(image.with?.['cache-to']).toBe(
      `${cache},mode=max,ignore-error=true`,
    );
    const build = await workflow();
    for (const step of Object.values(build.jobs).flatMap(
      (job) => job.steps ?? [],
    )) {
      expect(String(step.with?.['cache-to'] ?? '')).not.toContain('buildcache');
    }
    expect(image.with?.tags).not.toContain('buildcache');
  });
});
