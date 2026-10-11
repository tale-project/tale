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

  const labels = (): Record<string, string> => ({
    [`${OCI}.created`]: '2026-10-11T00:00:00Z',
    [`${OCI}.revision`]: REVISION,
    [`${OCI}.source`]: 'https://github.com/tale-project/tale',
    [`${OCI}.version`]: VERSION,
    [`${OCI}.title`]: 'tale-db',
    [`${OCI}.description`]: 'Tale DB — ParadeDB, with a comma',
    [`${OCI}.url`]: 'https://tale.dev',
    [`${OCI}.documentation`]: 'https://docs.tale.dev',
    [`${OCI}.vendor`]: 'Tale',
    [`${OCI}.licenses`]: 'MIT',
    'io.tale.automation-writer-protocol': '2',
    // What a base image leaves in the config: one architecture's build, not
    // something the index of both may say.
    [`${OCI}.base.name`]: 'docker.io/library/debian:bookworm-slim',
    [`${OCI}.base.digest`]: `sha256:${'f'.repeat(64)}`,
    'com.example.base-image-label': 'not ours to republish',
  });
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
    const directory = await mkdtemp(join(tmpdir(), 'tale-oci-index-'));
    temporary.push(directory);
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
      'SOURCE_SHA',
      'SITES_ONLY',
      'VERSION',
    ]);
    const child = Bun.spawn(
      [
        process.platform === 'darwin' ? '/bin/bash' : 'bash',
        '-e',
        '-c',
        publication.run!,
      ],
      {
        cwd: directory,
        env: {
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          STATE: directory,
          OCI_METADATA_KEYS: file.env!.OCI_METADATA_KEYS!,
          SERVICE: 'db',
          IMAGE,
          VERSION,
          SOURCE_SHA: REVISION,
          SITES_ONLY: String(sitesOnly),
          GITHUB_SHA: REVISION,
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
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
    const calls = (await readFile(join(directory, 'calls'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/\t$/, '').split('\t'));
    return {
      code,
      output: stdout + stderr,
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

  test('the workflow names the metadata keys the index and the images must carry', async () => {
    expect((await workflow('release')).env?.OCI_METADATA_KEYS).toBe(
      METADATA_KEYS.join(' '),
    );
  });

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
        Object.entries(labels())
          .filter(
            ([key]) =>
              METADATA_KEYS.some((name) => key === `${OCI}.${name}`) ||
              key.startsWith('io.tale.'),
          )
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
