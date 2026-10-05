import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { parse } from 'yaml';

const repository = resolve(import.meta.dir, '../../..');
const helper = join(repository, '.github/scripts/pull-ci-images.sh');
const temporary: string[] = [];
const revision = 'a'.repeat(40);
const services = [
  'db',
  'platform',
  'proxy',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  'sandbox-buildkitd',
  'sandbox-runtime',
];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

type Event = { kind: string; service: string };
type State = { active: number; maximum: number; events: Event[] };
type Step = {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = { jobs: Record<string, { steps: Step[]; strategy?: unknown }> };

async function workflow(name: string): Promise<Workflow> {
  return parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-ci-image-pulls-'));
  temporary.push(directory);
  const state = join(directory, 'state.json');
  await writeFile(state, JSON.stringify({ active: 0, maximum: 0, events: [] }));
  await writeFile(
    join(directory, 'docker'),
    `#!/usr/bin/env python3
import fcntl, json, os, re, sys, time
args = sys.argv[1:]
image = args[1] if args[0] in ('pull', 'tag') else args[-1]
service = re.search(r'tale-([a-z0-9-]+)(?:@|:)', image).group(1)
def event(kind, delta=0):
    with open(os.environ['TEST_STATE'], 'r+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        state = json.load(stream)
        state['active'] += delta
        state['maximum'] = max(state['maximum'], state['active'])
        state['events'].append(dict(kind=kind, service=service))
        stream.seek(0)
        json.dump(state, stream)
        stream.truncate()
        fcntl.flock(stream, fcntl.LOCK_UN)
failure = os.environ.get('TEST_FAILURE')
if args[0] == 'pull':
    event('start', 1)
    time.sleep(0.5 if service in ('platform', 'sandbox-runtime') else 0.03)
    event('finish', -1)
    if failure == 'pull' and service == 'platform': sys.exit(2)
elif args[:2] == ['image', 'inspect']:
    event('inspect')
    if failure == 'inspect' and service == 'platform': sys.exit(3)
    print('b' * 40 if failure == 'revision' and service == 'platform' else os.environ['TEST_REVISION'])
elif args[0] == 'tag':
    event('alias' if args[2].startswith('tale-') else 'tag')
    if failure == 'tag' and service == 'platform': sys.exit(4)
else:
    sys.exit(5)
`,
    { mode: 0o755 },
  );
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TEST_STATE: state,
      TEST_REVISION: revision,
      REGISTRY_PATH: 'ghcr.io/tale-project/tale',
      SOURCE_SHA: revision,
      IMAGE_TAG: '0.5.73-amd64',
    },
    state: async () => JSON.parse(await readFile(state, 'utf8')) as State,
  };
}

async function run(
  script: string[],
  env: Record<string, string | undefined>,
  cwd?: string,
) {
  const child = Bun.spawn(script, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test
  .skipIf(process.platform === 'win32')
  .each(['smoke-test', 'image-validate'])(
  '%s can validate old candidate C using only the isolated helper from exact workflow H',
  async (id) => {
    const job = (await workflow('build')).jobs[id];
    const checkout = job?.steps.find(
      (step) => step.name === 'Checkout CI image pull helper',
    );
    expect(checkout?.if).toBe("needs.changes.outputs.candidate_sha != ''");
    expect(checkout?.uses).toBe(
      'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
    );
    expect(checkout?.with).toEqual({
      ref: '${{ github.workflow_sha }}',
      path: '.ci-workflow',
      'persist-credentials': false,
      'sparse-checkout': '.github/scripts/pull-ci-images.sh',
      'sparse-checkout-cone-mode': false,
    });
    expect(job?.steps.find((step) => step.name === 'Checkout')?.with?.ref).toBe(
      '${{ needs.changes.outputs.candidate_sha }}',
    );
    const pull = job?.steps.find(
      (step) => step.name === 'Pull images from GHCR',
    );
    const helperExpression = pull?.env?.PULL_HELPER?.replace(
      /^\$\{\{\s*|\s*\}\}$/g,
      '',
    );
    if (!helperExpression || !pull?.run)
      throw new Error('Candidate image helper selection is missing');
    for (const candidate of [revision, '']) {
      const proof = await fixture();
      // This proof checks checkout provenance; the separate concurrency suite
      // owns download scheduling. Keep the stand-in cheap under full CI load.
      const inspections = join(proof.directory, 'inspections');
      await writeFile(inspections, '');
      await writeFile(
        join(proof.directory, 'docker'),
        '#!/bin/sh\nif [ "$1 $2" = "image inspect" ]; then\n  printf "%s\\n" "$*" >> "$TEST_INSPECTIONS"\n  printf "%s\\n" "$TEST_REVISION"\nfi\n',
        { mode: 0o755 },
      );
      const path = runInNewContext(helperExpression, {
        needs: { changes: { outputs: { candidate_sha: candidate } } },
      }) as string;
      expect(path).toBe(
        candidate
          ? '.ci-workflow/.github/scripts/pull-ci-images.sh'
          : '.github/scripts/pull-ci-images.sh',
      );
      // This checkout represents C without the newly introduced helper. Only
      // H's isolated directory exists for candidates; ordinary events use C.
      const isolated = join(proof.directory, path);
      await mkdir(dirname(isolated), { recursive: true });
      await writeFile(isolated, await readFile(helper, 'utf8'));
      for (const service of services) {
        await writeFile(
          join(proof.directory, `${service}.json`),
          JSON.stringify({ digest: `sha256:${'c'.repeat(64)}` }),
        );
      }
      const result = await run(
        ['bash', '-c', pull.run],
        {
          ...proof.env,
          IMAGE_TAG: '',
          RECEIPTS: proof.directory,
          PULL_HELPER: path,
          TEST_INSPECTIONS: inspections,
        },
        proof.directory,
      );
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(
        (await readFile(inspections, 'utf8')).trim().split('\n'),
      ).toHaveLength(services.length);
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'parallel pulls remain bounded and await out-of-order downloads before success',
  async () => {
    const proof = await fixture();
    const result = await run(['bash', helper, ...services], proof.env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const state = await proof.state();
    expect(state.maximum).toBeGreaterThan(1);
    expect(state.maximum).toBeLessThanOrEqual(3);
    expect(state.active).toBe(0);
    const firstAlias = state.events.findIndex(
      (event) => event.kind === 'alias',
    );
    const lastVerification = state.events.findLastIndex(
      (event) => event.kind === 'tag',
    );
    expect(firstAlias).toBeGreaterThan(lastVerification);
    expect(
      state.events
        .filter((event) => event.kind === 'finish')
        .map((event) => event.service)
        .toSorted(),
    ).toEqual(services.toSorted());
    const firstFinished = state.events.find((event) => event.kind === 'finish');
    expect(['platform', 'sandbox-runtime']).not.toContain(
      firstFinished?.service,
    );
    for (const service of services) {
      expect(
        state.events
          .filter((event) => event.service === service)
          .map((event) => event.kind),
      ).toEqual([
        'start',
        'finish',
        'inspect',
        'tag',
        ...(['sandbox-runtime', 'sandbox-buildkitd'].includes(service)
          ? ['alias']
          : []),
      ]);
    }
  },
);

test
  .skipIf(process.platform === 'win32')
  .each(['pull', 'inspect', 'revision', 'tag'])(
  '%s failure fails the image gate and still waits for every launched download',
  async (failure) => {
    const proof = await fixture();
    const result = await run(['bash', helper, ...services], {
      ...proof.env,
      TEST_FAILURE: failure,
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('::error::');
    const state = await proof.state();
    expect(state.active).toBe(0);
    expect(state.events.some((event) => event.kind === 'alias')).toBe(false);
    expect(
      state.events.filter((event) => event.kind === 'finish'),
    ).toHaveLength(
      state.events.filter((event) => event.kind === 'start').length,
    );
    if (failure !== 'tag') {
      expect(
        state.events.some(
          (event) => event.service === 'platform' && event.kind === 'tag',
        ),
      ).toBe(false);
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'a missing final receipt prevents every pull, rather than accepting a partial stack',
  async () => {
    const proof = await fixture();
    for (const service of services.slice(0, -1)) {
      await writeFile(
        join(proof.directory, `${service}.json`),
        JSON.stringify({ digest: `sha256:${'c'.repeat(64)}` }),
      );
    }
    const result = await run(['bash', helper, ...services], {
      ...proof.env,
      IMAGE_TAG: '',
      RECEIPTS: proof.directory,
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain(
      'No image receipt with a digest for tale-sandbox-runtime',
    );
    expect((await proof.state()).events).toEqual([]);
  },
);

test('Release keeps GHA reads, architecture registry writes and native runner fanout', async () => {
  const release = await workflow('release');
  const build = release.jobs.build;
  const image = build?.steps.find((step) => step.name === 'Build and push');
  expect(image?.with?.['cache-from']).toContain("matrix.arch.name == 'amd64'");
  expect(image?.with?.['cache-from']).toContain(
    "format('type=gha,scope={0}', matrix.service.name)",
  );
  expect(image?.with?.['cache-from']).toContain(
    '-buildcache:${{ matrix.arch.name }}',
  );
  expect(image?.with?.['cache-to']).toContain(
    '-buildcache:${{ matrix.arch.name }},mode=max,ignore-error=true',
  );
  expect(build?.strategy).toMatchObject({ 'max-parallel': 6 });
});

test('CLI keeps source and compiled smoke coverage on every native OS', async () => {
  const cli = await workflow('cli');
  const build = cli.jobs.build;
  expect(build?.steps.find((step) => step.name === 'Run unit tests')?.if).toBe(
    '${{ !matrix.cross }}',
  );
  expect(build?.steps.find((step) => step.name === 'Run smoke tests')?.if).toBe(
    '${{ !matrix.cross }}',
  );
  expect(build?.strategy).toMatchObject({
    matrix: {
      include: expect.arrayContaining([
        expect.objectContaining({ platform: 'linux', os: 'ubuntu-latest' }),
        expect.objectContaining({ platform: 'macos', os: 'macos-latest' }),
        expect.objectContaining({ platform: 'windows', os: 'windows-latest' }),
      ]),
    },
  });
});
