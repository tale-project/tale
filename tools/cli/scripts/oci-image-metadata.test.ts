import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

/**
 * Tale's images are OCI artifacts that say what they are. A registry, a
 * scanner and `docker inspect` read the org.opencontainers.image.* labels of an
 * image's config, and a base image's own labels reach ours unless the final
 * stage overrides them (the released web image claimed Bun's URL and an
 * unasserted license, the proxy Caddy's URL and docs). This file keeps every
 * image's metadata complete and the release's index an annotated OCI index.
 * Each section runs the real file or workflow script; none of them restates a
 * value the build decides.
 */

const repository = resolve(import.meta.dir, '../../..');
const OCI = 'org.opencontainers.image';
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  env?: Record<string, string>;
  jobs: Record<string, { needs?: string | string[]; steps?: Step[] }>;
};

async function workflow(name: 'build' | 'release'): Promise<Workflow> {
  return parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

function step(file: Workflow, job: string, name: string): Step {
  const found = file.jobs[job]?.steps?.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${job}: ${name}`);
  return found;
}

/** Every docker/build-push-action step of a workflow, and the job it is in. */
function pushSteps(file: Workflow) {
  return Object.entries(file.jobs).flatMap(([job, { steps = [] }]) =>
    steps
      .filter((entry) => entry.uses?.startsWith('docker/build-push-action@'))
      .map((entry) => ({ job, entry })),
  );
}

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tale-oci-'));
  temporary.push(directory);
  return directory;
}

/**
 * The config labels of a pushed platform image: everything Tale declares, its
 * writer protocol, and what a base image leaves behind (one architecture's
 * build, which neither a manifest nor an index of both may repeat).
 */
function imageLabels(version: string, revision: string) {
  return {
    [`${OCI}.created`]: '2026-10-11T00:00:00Z',
    [`${OCI}.revision`]: revision,
    [`${OCI}.source`]: 'https://github.com/tale-project/tale',
    [`${OCI}.version`]: version,
    [`${OCI}.title`]: 'tale-db',
    [`${OCI}.description`]: 'Tale DB — ParadeDB, with a comma',
    [`${OCI}.url`]: 'https://tale.dev',
    [`${OCI}.documentation`]: 'https://docs.tale.dev',
    [`${OCI}.vendor`]: 'Tale',
    [`${OCI}.licenses`]: 'MIT',
    'io.tale.automation-writer-protocol': '2',
    [`${OCI}.base.name`]: 'docker.io/library/debian:bookworm-slim',
    [`${OCI}.base.digest`]: `sha256:${'f'.repeat(64)}`,
    'com.example.base-image-label': 'not ours to republish',
  } as Record<string, string>;
}

/** What Tale repeats on an index or manifest: its own metadata, not the base's. */
const repeated = (labels: Record<string, string>) =>
  Object.entries(labels).filter(
    ([key]) =>
      METADATA_KEYS.some((name) => key === `${OCI}.${name}`) ||
      key.startsWith('io.tale.'),
  );

/**
 * A step's own script, run the way the runner runs it, with exactly the
 * environment given: the fixtures resolve each expression the step's `env`
 * would carry.
 */
async function runScript(
  script: string,
  cwd: string,
  env: Record<string, string>,
) {
  const child = Bun.spawn(
    [process.platform === 'darwin' ? '/bin/bash' : 'bash', '-e', '-c', script],
    { cwd, env, stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: stdout + stderr };
}

/**
 * What every Tale image says about itself, apart from its title, description
 * and version. `source` is exact: the CLI refuses an image whose source label
 * differs (tools/cli/src/lib/deployment/tag-automation-protocol.ts).
 */
const IDENTITY: Record<string, string> = {
  source: 'https://github.com/tale-project/tale',
  url: 'https://tale.dev',
  documentation: 'https://docs.tale.dev',
  vendor: 'Tale',
  licenses: 'MIT',
};
const DECLARED = [
  'title',
  'description',
  'version',
  ...Object.keys(IDENTITY),
] as const;
/**
 * The metadata every published image and index carries, without the prefix:
 * what the Dockerfile declares, and the two keys only a build can know. The
 * order is the one the workflows name them in.
 */
const METADATA_KEYS = [
  ...new Set(['created', 'revision', 'source', 'version', ...DECLARED]),
];
/**
 * What only the Dockerfile says, and the build repeats on the manifest. Source
 * and version are declared there too, but the workflows give them the values
 * the build knows, as they do for the labels.
 */
const STATIC_KEYS = DECLARED.filter(
  (key) => key !== 'source' && key !== 'version',
);

const services = readdirSync(join(repository, 'services'), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(repository, 'services', entry.name, 'Dockerfile')),
  )
  .map((entry) => entry.name)
  .toSorted();

interface Instruction {
  keyword: string;
  args: string;
}

/**
 * The instructions of a Dockerfile as BuildKit reads them: a trailing
 * backslash continues a line, and comment and blank lines are dropped.
 */
function instructionsOf(dockerfile: string): Instruction[] {
  const instructions: Instruction[] = [];
  let pending = '';
  for (const line of dockerfile.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    pending += line.replace(/\\\s*$/, '');
    if (/\\\s*$/.test(line)) continue;
    const match = /^\s*(\S+)\s*(.*)$/s.exec(pending);
    pending = '';
    if (match)
      instructions.push({ keyword: match[1]!.toUpperCase(), args: match[2]! });
  }
  return instructions;
}

/** What ships: everything from the last FROM on. */
function finalStage(dockerfile: string): Instruction[] {
  const instructions = instructionsOf(dockerfile);
  return instructions.slice(
    instructions.findLastIndex((entry) => entry.keyword === 'FROM'),
  );
}

/** The `key=value` pairs of the final stage's LABEL instructions. */
function labelsOf(stage: Instruction[]): { key: string; raw: string }[] {
  return stage
    .filter((entry) => entry.keyword === 'LABEL')
    .flatMap((entry) =>
      [...entry.args.matchAll(/([^\s=]+)=("(?:[^"\\]|\\.)*"|\S*)/g)].map(
        (match) => ({ key: match[1]!, raw: match[2]! }),
      ),
    );
}

/** Every way a Dockerfile's final stage falls short of the label contract. */
function problemsOf(service: string, dockerfile: string): string[] {
  const stage = finalStage(dockerfile);
  const labels = labelsOf(stage);
  const problems: string[] = [];
  const value = (key: string) => {
    const raw = labels.find((label) => label.key === `${OCI}.${key}`)?.raw;
    return raw?.replace(/^"(.*)"$/s, '$1');
  };
  for (const key of DECLARED)
    if (value(key) === undefined)
      problems.push(`${OCI}.${key} is not declared by the final stage`);
  for (const label of labels) {
    if (labels.filter((other) => other.key === label.key).length > 1)
      problems.push(`${label.key} is declared twice in the final stage`);
    // The release workflow reads these values back out of the Dockerfile, one
    // quoted `key="value"` each.
    if (label.key.startsWith(`${OCI}.`) && !/^"[^"\\]*"$/.test(label.raw))
      problems.push(`${label.key} must be one double-quoted value`);
  }
  // A value that is declared must also be the right one; one that is not has
  // been reported above.
  const expected: Record<string, string> = {
    ...IDENTITY,
    title: `tale-${service}`,
    version: '${VERSION}',
  };
  for (const [key, want] of Object.entries(expected))
    if (value(key) !== undefined && value(key) !== want)
      problems.push(`${OCI}.${key} must be ${want}, not ${value(key)}`);
  const description = value('description');
  if (description !== undefined && !/^[^\n"\\$]{10,160}$/.test(description))
    problems.push(`${OCI}.description must be 10 to 160 plain characters`);
  // ARG values do not survive a FROM: the stage declares VERSION itself, ahead
  // of the label that reads it.
  const argument = stage.findIndex(
    (entry) => entry.keyword === 'ARG' && /^VERSION(?:=|$)/.test(entry.args),
  );
  const version = stage.findIndex(
    (entry) =>
      entry.keyword === 'LABEL' && entry.args.includes(`${OCI}.version=`),
  );
  if (argument === -1 || (version !== -1 && argument > version))
    problems.push('the final stage must declare ARG VERSION before its label');
  return problems;
}

const dockerfile = (service: string) =>
  readFileSync(join(repository, `services/${service}/Dockerfile`), 'utf8');

describe('every image declares the OCI labels a registry and docker inspect read', () => {
  test('the guard sees every image the repository builds', () => {
    expect(services).toContain('platform');
    expect(services).toContain('sandbox-runtime');
    expect(services.length).toBeGreaterThanOrEqual(12);
  });

  test.each(services)(
    '%s: the final stage carries the whole set, with the fixed source',
    (service) => {
      expect(problemsOf(service, dockerfile(service))).toEqual([]);
    },
  );

  describe('the check itself', () => {
    const db = dockerfile('db');
    const without = (key: string) =>
      db
        .split('\n')
        .filter((line) => !line.includes(`${OCI}.${key}=`))
        .join('\n');

    test('accepts the real db image', () => {
      expect(problemsOf('db', db)).toEqual([]);
    });

    test.each(DECLARED.filter((key) => key !== 'version'))(
      'refuses a final stage without %s',
      (key) => {
        expect(problemsOf('db', without(key))).toContain(
          `${OCI}.${key} is not declared by the final stage`,
        );
      },
    );

    test('refuses another source, which the CLI would refuse at deploy time', () => {
      expect(
        problemsOf(
          'db',
          db.replace(IDENTITY.source!, 'https://github.com/example/fork'),
        ),
      ).toContain(
        `${OCI}.source must be ${IDENTITY.source}, not https://github.com/example/fork`,
      );
    });

    test('refuses a version label read before ARG VERSION is declared', () => {
      expect(
        problemsOf('db', db.replace(/^ARG VERSION=dev$/gm, '# no ARG')),
      ).toContain('the final stage must declare ARG VERSION before its label');
    });

    test('refuses labels left in a stage that does not ship (the platform image)', () => {
      const squash = [
        'FROM debian:bookworm-slim AS runner',
        'ARG VERSION=dev',
        `LABEL ${OCI}.version="\${VERSION}" \\`,
        `      ${OCI}.title="tale-platform" \\`,
        `      ${OCI}.description="Tale Platform — the stage that does not ship" \\`,
        `      ${OCI}.source="${IDENTITY.source}"`,
        'FROM scratch',
        'COPY --from=runner / /',
        'ARG VERSION=dev',
        `LABEL ${OCI}.version="\${VERSION}"`,
      ].join('\n');
      expect(problemsOf('platform', squash)).toEqual([
        `${OCI}.title is not declared by the final stage`,
        `${OCI}.description is not declared by the final stage`,
        `${OCI}.source is not declared by the final stage`,
        `${OCI}.url is not declared by the final stage`,
        `${OCI}.documentation is not declared by the final stage`,
        `${OCI}.vendor is not declared by the final stage`,
        `${OCI}.licenses is not declared by the final stage`,
      ]);
    });

    test('refuses an unquoted value and a label declared twice', () => {
      expect(
        problemsOf(
          'db',
          db.replace(
            'org.opencontainers.image.vendor="Tale"',
            `${OCI}.vendor=Tale`,
          ),
        ),
      ).toContain(`${OCI}.vendor must be one double-quoted value`);
      expect(problemsOf('db', `${db}\nLABEL ${OCI}.vendor="Tale"\n`)).toContain(
        `${OCI}.vendor is declared twice in the final stage`,
      );
    });
  });
});

describe('published images are OCI artifacts', () => {
  test.each(['build', 'release'] as const)(
    '%s.yml exports every pushed image with OCI media types',
    async (name) => {
      const pushes = pushSteps(await workflow(name));
      expect(pushes.length).toBeGreaterThan(0);
      for (const { job, entry } of pushes) {
        const attributes = String(entry.with?.outputs).split(',');
        expect(attributes, `${name}.yml ${job}: ${entry.name}`).toContain(
          'type=image',
        );
        expect(attributes, `${name}.yml ${job}: ${entry.name}`).toContain(
          'oci-mediatypes=true',
        );
      }
    },
  );

  test.each(['build', 'release'] as const)(
    '%s.yml names the metadata keys every image and index must carry',
    async (name) => {
      expect((await workflow(name)).env?.OCI_METADATA_KEYS).toBe(
        METADATA_KEYS.join(' '),
      );
    },
  );

  test('no workflow assembles an index with docker manifest', async () => {
    const directory = join(repository, '.github/workflows');
    for (const name of await readdir(directory)) {
      const text = await readFile(join(directory, name), 'utf8');
      // `docker manifest inspect` only reads; creating, pushing or annotating
      // writes a list that cannot carry annotations.
      expect(text, name).not.toMatch(/docker manifest (create|push|annotate)/);
    }
  });
});

describe('the release publishes one annotated OCI image index per service', () => {
  const IMAGE = 'ghcr.io/tale-project/tale/tale-db';
  const VERSION = '1.2.3';
  const REVISION = 'c'.repeat(40);
  const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
  const AMD64 = digest('a');
  const ARM64 = digest('b');
  const INDEX = digest('c');

  const labels = () => imageLabels(VERSION, REVISION);
  const publishedIndex = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      [AMD64, 'amd64'],
      [ARM64, 'arm64'],
    ].map(([manifest, architecture]) => ({
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest: manifest,
      size: 700,
      platform: { os: 'linux', architecture },
    })),
    annotations: {
      [`${OCI}.version`]: VERSION,
      [`${OCI}.revision`]: REVISION,
    },
    ...overrides,
  });

  /**
   * A registry holding the two native images, behind a stand-in `docker` that
   * answers the reads `docker buildx imagetools` would make and records every
   * call. `docker manifest` is deliberately absent: it exits non-zero.
   */
  async function fixture(
    options: {
      config?: Record<string, string>;
      index?: unknown;
      latest?: string;
      arm64?: string;
    } = {},
  ) {
    const directory = await scratch();
    await mkdir(join(directory, 'bin'));
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        architecture: 'amd64',
        os: 'linux',
        config: { Labels: options.config ?? labels() },
      }),
    );
    await writeFile(
      join(directory, 'index.json'),
      JSON.stringify(options.index ?? publishedIndex()),
    );
    await writeFile(join(directory, 'amd64.digest'), AMD64);
    await writeFile(join(directory, 'arm64.digest'), options.arm64 ?? ARM64);
    await writeFile(join(directory, 'latest.digest'), options.latest ?? INDEX);
    await writeFile(join(directory, 'index.digest'), INDEX);
    await writeFile(join(directory, 'summary.md'), '');
    await writeFile(
      join(directory, 'bin/docker'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t' "$@" >> "$STATE/calls"
printf '\\n' >> "$STATE/calls"
if [ "\${1:-}" = manifest ]; then echo 'docker manifest is not available' >&2; exit 97; fi
case "$*" in
  'buildx version') echo 'github.com/docker/buildx v0.0.0-fixture' ;;
  'buildx imagetools create '*) ;;
  'buildx imagetools inspect '*' --format {{json .Image}}') cat "$STATE/config.json" ;;
  'buildx imagetools inspect '*' --raw') cat "$STATE/index.json" ;;
  'buildx imagetools inspect '*' --format {{.Manifest.Digest}}')
    case "$4" in
      *-amd64) cat "$STATE/amd64.digest" ;;
      *-arm64) cat "$STATE/arm64.digest" ;;
      *:latest) cat "$STATE/latest.digest" ;;
      *) cat "$STATE/index.digest" ;;
    esac ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
`,
    );
    await chmod(join(directory, 'bin/docker'), 0o755);
    return directory;
  }

  async function publish(directory: string, sitesOnly: boolean) {
    const file = await workflow('release');
    const publication = step(
      file,
      'manifest',
      'Create and push the OCI image index',
    );
    // The step's own env is expressions; the fixture resolves each of them.
    expect(Object.keys(publication.env ?? {}).toSorted()).toEqual([
      'IMAGE',
      'SERVICE',
      'SITES_ONLY',
      'SOURCE_SHA',
      'VERSION',
    ]);
    const { code, output } = await runScript(publication.run!, directory, {
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      STATE: directory,
      OCI_METADATA_KEYS: file.env!.OCI_METADATA_KEYS!,
      SERVICE: 'db',
      IMAGE,
      VERSION,
      SOURCE_SHA: REVISION,
      SITES_ONLY: String(sitesOnly),
      GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
    });
    const calls = (await readFile(join(directory, 'calls'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/\t$/, '').split('\t'));
    return {
      code,
      output,
      calls,
      create: calls.find(
        (call) => call.slice(0, 3).join(' ') === 'buildx imagetools create',
      ),
      summary: await readFile(join(directory, 'summary.md'), 'utf8'),
    };
  }
  const flagValues = (call: string[], flag: string) =>
    call.flatMap((argument, index) =>
      argument === flag ? [call[index + 1]!] : [],
    );

  test('imagetools writes the index, never docker manifest', async () => {
    const run = step(
      await workflow('release'),
      'manifest',
      'Create and push the OCI image index',
    ).run!;
    expect(run).toContain('docker buildx imagetools create');
    expect(run).not.toContain('docker manifest');
  });

  test.skipIf(process.platform === 'win32')(
    'a full release writes :version and :latest in one call, annotated with the image labels',
    async () => {
      const result = await publish(await fixture(), false);
      expect(result.code, result.output).toBe(0);
      expect(result.create).toBeDefined();
      expect(
        result.calls.filter((call) => call[2] === 'create'),
        'one call writes every tag, so they name one index',
      ).toHaveLength(1);
      const create = result.create!;
      expect(flagValues(create, '--tag')).toEqual([
        `${IMAGE}:${VERSION}`,
        `${IMAGE}:latest`,
      ]);
      expect(create.slice(-2)).toEqual([
        `${IMAGE}:${VERSION}-amd64`,
        `${IMAGE}:${VERSION}-arm64`,
      ]);
      // Tale's own metadata and nothing a base image left in the config.
      expect(flagValues(create, '--annotation')).toEqual(
        repeated(labels())
          .map(([key, value]) => `index:${key}=${value}`)
          .toSorted(),
      );
      expect(result.summary).toContain(`${IMAGE}@${INDEX}`);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a content-site release leaves :latest alone',
    async () => {
      // :latest names another index here; a content-site release never reads it.
      const result = await publish(
        await fixture({ latest: digest('d') }),
        true,
      );
      expect(result.code, result.output).toBe(0);
      expect(flagValues(result.create!, '--tag')).toEqual([
        `${IMAGE}:${VERSION}`,
      ]);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'an image missing part of the metadata set stops the release before a tag moves',
    async () => {
      for (const key of METADATA_KEYS) {
        const config = labels();
        delete config[`${OCI}.${key}`];
        const result = await publish(await fixture({ config }), false);
        expect(result.code, key).not.toBe(0);
        expect(result.output, key).toContain(`::error::`);
        expect(result.create, `${key}: nothing is published`).toBeUndefined();
      }
    },
  );

  test.skipIf(process.platform === 'win32').each([
    [
      'a Docker manifest list',
      {
        index: publishedIndex({
          mediaType:
            'application/vnd.docker.distribution.manifest.list.v2+json',
        }),
      },
    ],
    [
      'an index without annotations',
      { index: publishedIndex({ annotations: undefined }) },
    ],
    [
      'an index of one platform',
      {
        index: publishedIndex({
          manifests: publishedIndex().manifests.slice(0, 1),
        }),
      },
    ],
    ['an arm64 image pushed after the index', { arm64: digest('e') }],
  ])('the proof refuses %s', async (_label, options) => {
    const result = await publish(await fixture(options), false);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('::error::');
  });

  test.skipIf(process.platform === 'win32')(
    'the proof refuses a :latest that names another index',
    async () => {
      const result = await publish(
        await fixture({ latest: digest('d') }),
        false,
      );
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain(`${IMAGE}:latest does not name`);
    },
  );
});

describe('every pushed image repeats its metadata as manifest annotations', () => {
  const builds: ('build' | 'release')[] = ['build', 'release'];
  const lines = (text: unknown) =>
    String(text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const buildSteps = async (name: (typeof builds)[number]) =>
    (await workflow(name)).jobs.build!.steps!;

  test.each(builds)(
    '%s.yml annotates every pushed image with what it labels it',
    async (name) => {
      const pushes = pushSteps(await workflow(name));
      expect(pushes.length).toBeGreaterThan(0);
      for (const { job, entry } of pushes) {
        const where = `${name}.yml ${job}: ${entry.name}`;
        const labels = lines(entry.with?.labels);
        const annotations = lines(entry.with?.annotations);
        expect(labels.length, where).toBeGreaterThan(0);
        // Every label the build supplies is repeated, expression for expression.
        for (const label of labels) expect(annotations, where).toContain(label);
        for (const key of ['created', 'revision', 'source', 'version'])
          expect(
            annotations.some((line) => line.startsWith(`${OCI}.${key}=`)),
            `${where}: ${key}`,
          ).toBe(true);
        // The rest comes from the Dockerfile, through the resolving step.
        expect(annotations, where).toContain(
          '${{ steps.annotations.outputs.static }}',
        );
      }
    },
  );

  test.each(builds)(
    '%s.yml resolves the annotations before the build and verifies them after every attempt',
    async (name) => {
      const steps = await buildSteps(name);
      const at = (title: string) =>
        steps.findIndex((entry) => entry.name === title);
      const pushes = steps.flatMap((entry, index) =>
        entry.uses?.startsWith('docker/build-push-action@') ? [index] : [],
      );
      expect(steps[at('Resolve image annotations')]?.id).toBe('annotations');
      expect(at('Resolve image annotations')).toBeLessThan(Math.min(...pushes));
      expect(at('Verify image annotations')).toBeGreaterThan(
        Math.max(...pushes),
      );
    },
  );

  test('the verification reads the digest of the push that stood', async () => {
    const build = step(
      await workflow('build'),
      'build',
      'Verify image annotations',
    );
    expect(build.env?.DIGEST).toBe('${{ steps.image.outputs.digest }}');
    const names = (await buildSteps('build')).map((entry) => entry.name);
    // The receipt the later jobs test names this digest, so it follows the proof.
    expect(names.indexOf('Verify image annotations')).toBeLessThan(
      names.indexOf('Record image receipt'),
    );
    // A retry's digest replaces the first attempt's when the first failed.
    expect(
      step(await workflow('release'), 'build', 'Verify image annotations').env
        ?.DIGEST,
    ).toBe(
      '${{ steps.image_retry.outputs.digest || steps.image.outputs.digest }}',
    );
  });

  test.each(['Resolve image annotations', 'Verify image annotations'])(
    '%s is one script in both workflows',
    async (title) => {
      const script = step(await workflow('build'), 'build', title).run;
      expect(script).toBeDefined();
      expect(step(await workflow('release'), 'build', title).run).toBe(script);
    },
  );

  describe.skipIf(process.platform === 'win32')('the resolving step', () => {
    const resolveIn = async (
      name: (typeof builds)[number],
      cwd: string,
      service: string,
    ) => {
      const output = join(await scratch(), 'output');
      await writeFile(output, '');
      const result = await runScript(
        step(await workflow(name), 'build', 'Resolve image annotations').run!,
        cwd,
        { PATH: process.env.PATH!, SERVICE: service, GITHUB_OUTPUT: output },
      );
      return { ...result, written: await readFile(output, 'utf8') };
    };

    test.each(services)(
      '%s: hands the build what its Dockerfile declares',
      async (service) => {
        const declared = labelsOf(finalStage(dockerfile(service)))
          .filter(({ key }) =>
            STATIC_KEYS.some((name) => key === `${OCI}.${name}`),
          )
          .map(({ key, raw }) => `${key}=${raw.slice(1, -1)}`)
          .toSorted();
        expect(declared).toHaveLength(STATIC_KEYS.length);
        for (const name of builds) {
          const result = await resolveIn(name, repository, service);
          expect(result.code, result.output).toBe(0);
          const [open, ...rest] = result.written.trimEnd().split('\n');
          expect(open).toBe('static<<OCI_ANNOTATIONS_EOF');
          expect(rest.at(-1)).toBe('OCI_ANNOTATIONS_EOF');
          expect(rest.slice(0, -1).toSorted()).toEqual(declared);
        }
      },
    );

    test('fails, saying how many labels it found, when the final stage lacks some', async () => {
      const directory = await scratch();
      await mkdir(join(directory, 'services/db'), { recursive: true });
      // Complete labels in a stage that does not ship, a commented-out one, and
      // two real ones: the platform image's defect, reduced.
      await writeFile(
        join(directory, 'services/db/Dockerfile'),
        [
          'FROM scratch AS runner',
          ...STATIC_KEYS.map((key) => `LABEL ${OCI}.${key}="runner ${key}"`),
          'FROM scratch',
          `# LABEL ${OCI}.vendor="Tale"`,
          `LABEL ${OCI}.title="tale-db" ${OCI}.description="Tale DB"`,
          '',
        ].join('\n'),
      );
      const result = await resolveIn('build', directory, 'db');
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        `::error::The final stage of services/db/Dockerfile declares 2 of its OCI labels`,
      );
      expect(result.written).toBe('');
    });
  });

  describe.skipIf(process.platform === 'win32').each(builds)(
    '%s.yml verification of the pushed manifest',
    (name) => {
      const IMAGE = 'ghcr.io/tale-project/tale/tale-platform';
      const DIGEST = `sha256:${'d'.repeat(64)}`;
      const VERSION = '1.2.3';
      const REVISION = 'e'.repeat(40);
      const manifestOf = (
        annotations?: Record<string, string>,
        mediaType = 'application/vnd.oci.image.manifest.v1+json',
      ) => ({
        schemaVersion: 2,
        mediaType,
        config: {
          mediaType: 'application/vnd.oci.image.config.v1+json',
          digest: `sha256:${'1'.repeat(64)}`,
          size: 1700,
        },
        layers: [],
        ...(annotations ? { annotations } : {}),
      });

      /** A registry holding one pushed manifest, behind a stand-in `docker`. */
      async function verify(
        options: {
          config?: Record<string, string>;
          annotations?: Record<string, string> | null;
          mediaType?: string;
          digest?: string;
          version?: string;
          revision?: string;
        } = {},
      ) {
        const directory = await scratch();
        await mkdir(join(directory, 'bin'));
        const config = options.config ?? imageLabels(VERSION, REVISION);
        const annotations =
          options.annotations === null
            ? undefined
            : (options.annotations ?? Object.fromEntries(repeated(config)));
        await writeFile(
          join(directory, 'manifest.json'),
          JSON.stringify(manifestOf(annotations, options.mediaType)),
        );
        await writeFile(
          join(directory, 'config.json'),
          JSON.stringify({
            architecture: 'arm64',
            os: 'linux',
            config: { Labels: config },
          }),
        );
        await writeFile(
          join(directory, 'bin/docker'),
          `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$STATE/calls"
case "$*" in
  'buildx imagetools inspect '*' --raw') cat "$STATE/manifest.json" ;;
  'buildx imagetools inspect '*' --format {{json .Image}}') cat "$STATE/config.json" ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
`,
        );
        await chmod(join(directory, 'bin/docker'), 0o755);
        await writeFile(join(directory, 'calls'), '');
        const file = await workflow(name);
        const result = await runScript(
          step(file, 'build', 'Verify image annotations').run!,
          directory,
          {
            PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
            STATE: directory,
            OCI_METADATA_KEYS: file.env!.OCI_METADATA_KEYS!,
            IMAGE,
            DIGEST: options.digest ?? DIGEST,
            VERSION: options.version ?? VERSION,
            REVISION: options.revision ?? REVISION,
          },
        );
        return {
          ...result,
          calls: (await readFile(join(directory, 'calls'), 'utf8'))
            .split('\n')
            .filter(Boolean),
        };
      }
      const refused = (result: { code: number; output: string }) => {
        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain('::error::');
      };

      test('accepts a manifest that repeats its labels, read back by digest', async () => {
        const result = await verify();
        expect(result.code, result.output).toBe(0);
        expect(result.calls).toEqual([
          `buildx imagetools inspect ${IMAGE}@${DIGEST} --raw`,
          `buildx imagetools inspect ${IMAGE}@${DIGEST} --format {{json .Image}}`,
        ]);
      });

      test.each(METADATA_KEYS)('refuses a manifest without %s', async (key) => {
        const annotations = Object.fromEntries(
          repeated(imageLabels(VERSION, REVISION)).filter(
            ([label]) => label !== `${OCI}.${key}`,
          ),
        );
        refused(await verify({ annotations }));
      });

      test('refuses a manifest that dropped the annotations, as buildx older than 0.12 does', async () => {
        refused(await verify({ annotations: null }));
      });

      test('refuses an annotation that differs from its label', async () => {
        const config = imageLabels(VERSION, REVISION);
        refused(
          await verify({
            annotations: {
              ...Object.fromEntries(repeated(config)),
              [`${OCI}.title`]: 'tale-other',
            },
          }),
        );
      });

      test("refuses a manifest that leaves out the platform image's writer protocol", async () => {
        const annotations = Object.fromEntries(
          repeated(imageLabels(VERSION, REVISION)).filter(
            ([label]) => label !== 'io.tale.automation-writer-protocol',
          ),
        );
        refused(await verify({ annotations }));
      });

      test('refuses an image index where a single image was pushed', async () => {
        refused(
          await verify({
            mediaType: 'application/vnd.oci.image.index.v1+json',
          }),
        );
      });

      test.each([
        ['another version', { version: '9.9.9' }],
        ['another revision', { revision: 'f'.repeat(40) }],
      ])('refuses %s than the run built', async (_label, options) => {
        refused(await verify(options));
      });

      test('refuses a build that reported no digest, without reading the registry', async () => {
        const result = await verify({ digest: '' });
        refused(result);
        expect(result.calls).toEqual([]);
      });
    },
  );
});

describe('every image the Dockerfiles pull is pinned by digest', () => {
  const files = [
    ...services.map((service) => `services/${service}/Dockerfile`),
    // A scaffolded service starts pinned, and Renovate manages the templates too.
    'tools/plop/templates/service/docker/Dockerfile.hbs',
    'tools/plop/templates/service/react/Dockerfile.hbs',
  ];
  /**
   * `image:tag@sha256:…`. A variable in the name part is refused: with a digest
   * present BuildKit pulls the digest and ignores the tag, so a build argument
   * could no longer steer the line it appears to steer.
   */
  const PINNED = /^[^\s@$]+@sha256:[a-f0-9]{64}$/;

  /**
   * Every image a Dockerfile pulls from a registry, in order: its `# syntax=`
   * frontend, each FROM, and each `--from=` of COPY, ADD and a RUN mount. A
   * stage of its own, a stage number and `scratch` pull nothing.
   */
  function pulledImages(text: string): string[] {
    const images: string[] = [];
    const stages = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*$/.test(line)) continue;
      const directive = /^#\s*syntax\s*=\s*(\S+)/i.exec(line);
      if (directive) images.push(directive[1]!);
      // Parser directives sit above the first instruction and nothing else.
      if (!line.startsWith('#')) break;
    }
    const own = (reference: string) =>
      /^\d+$/.test(reference) || stages.has(reference.toLowerCase());
    for (const { keyword, args } of instructionsOf(text)) {
      const words = args.trim().split(/\s+/);
      if (keyword === 'FROM') {
        const image = words.find((word) => !word.startsWith('--')) ?? '';
        if (image.toLowerCase() !== 'scratch' && !own(image))
          images.push(image);
        const alias = words.findIndex((word) => word.toUpperCase() === 'AS');
        if (alias !== -1) stages.add(words[alias + 1]!.toLowerCase());
      } else if (['COPY', 'ADD', 'RUN'].includes(keyword)) {
        for (const word of words) {
          const from =
            /^--from=(.+)$/i.exec(word)?.[1] ??
            (word.startsWith('--mount=')
              ? word
                  .slice('--mount='.length)
                  .split(',')
                  .find((part) => part.startsWith('from='))
                  ?.slice('from='.length)
              : undefined);
          if (from !== undefined && !own(from)) images.push(from);
        }
      }
    }
    return images;
  }

  test.each(files)('%s: every image it pulls carries a digest', (file) => {
    const images = pulledImages(readFileSync(join(repository, file), 'utf8'));
    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((image) => !PINNED.test(image))).toEqual([]);
  });

  test('one reference never carries two digests, which would leave one of them stale', () => {
    const digests = new Map<string, Set<string>>();
    for (const file of files)
      for (const image of pulledImages(
        readFileSync(join(repository, file), 'utf8'),
      )) {
        const [name, digest] = image.split('@') as [string, string];
        digests.set(name, (digests.get(name) ?? new Set()).add(digest));
      }
    expect(
      [...digests].filter(([, found]) => found.size > 1).map(([name]) => name),
    ).toEqual([]);
  });

  test('Renovate pins and keeps current the digest of every Dockerfile image', async () => {
    const config = JSON.parse(
      await readFile(join(repository, '.github/renovate.json'), 'utf8'),
    ) as {
      packageRules?: { matchManagers?: string[]; pinDigests?: boolean }[];
    };
    expect(
      config.packageRules?.some(
        (rule) =>
          rule.matchManagers?.includes('dockerfile') &&
          rule.pinDigests === true,
      ),
    ).toBe(true);
  });

  describe('the check itself', () => {
    const digest = `@sha256:${'a'.repeat(64)}`;
    const sample = [
      '# syntax=docker/dockerfile:1.7',
      '',
      `FROM oven/bun:1.4.2${digest} AS bun-bin`,
      'FROM debian:bookworm-slim AS base',
      'FROM --platform=$BUILDPLATFORM base AS deps',
      'FROM scratch',
      'COPY --from=bun-bin /usr/local/bin/bun /usr/local/bin/bun',
      'COPY --from=0 /a /b',
      'COPY --link --from=ghcr.io/amacneil/dbmate:2 /dbmate /dbmate',
      'RUN --mount=type=bind,from=alpine:3.20,target=/x true',
      'FROM docker:${DOCKER_CLI_VERSION}-cli AS docker-cli',
      '',
    ].join('\n');

    test('finds every pull, and none of a stage, a stage number or scratch', () => {
      expect(pulledImages(sample)).toEqual([
        'docker/dockerfile:1.7',
        `oven/bun:1.4.2${digest}`,
        'debian:bookworm-slim',
        'ghcr.io/amacneil/dbmate:2',
        'alpine:3.20',
        'docker:${DOCKER_CLI_VERSION}-cli',
      ]);
    });

    test('refuses a tag alone, a variable tag and a short digest, and accepts a digest', () => {
      const refused = [
        'debian:bookworm-slim',
        'docker:${DOCKER_CLI_VERSION}-cli',
        `docker:${'${V}'}-cli${digest}`,
        'oven/bun:1.4.2@sha256:abc',
      ];
      for (const image of refused)
        expect(PINNED.test(image), image).toBe(false);
      expect(PINNED.test(`debian:bookworm-slim${digest}`)).toBe(true);
    });

    test('reads a CRLF checkout the same way', () => {
      expect(pulledImages(sample.replaceAll('\n', '\r\n'))).toEqual(
        pulledImages(sample),
      );
    });
  });
});
