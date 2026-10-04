import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const workflow = async (name = 'build.yml') =>
  parse(
    await readFile(join(repository, '.github/workflows', name), 'utf8'),
  ) as Workflow;
const matches = (patterns: string[], path: string) =>
  patterns.some((pattern) => new Bun.Glob(pattern).match(path));
const filtersOf = (build: Workflow) =>
  parse(
    String(
      build.jobs.changes?.steps?.find((step) => step.name === 'Filter paths')
        ?.with?.filters,
    ),
  ) as Record<string, string[]>;

async function plan(build: Workflow, paths: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'tale-build-scope-'));
  roots.push(root);
  const output = join(root, 'output');
  await writeFile(output, '');
  const filters = filtersOf(build);
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
      CANDIDATE_SHA: '',
      CHANGES: JSON.stringify(changed),
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
  test('every Dockerfile COPY source is covered by its service or common input scope', async () => {
    const build = await workflow();
    const filters = filtersOf(build);
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
          if (build.jobs.build!.strategy!.matrix!.service!.includes(service)) {
            stackInputs.add(path);
          }
        }
      }
    }
    for (const path of stackInputs)
      expect((await plan(build, [path])).stack, `stack: ${path}`).toBe('true');
  });

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
