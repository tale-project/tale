import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { parse } from 'yaml';

import {
  RELEASE_FIELDS,
  latestDecision,
  parseRelease,
  type Release,
} from './release-latest';

/**
 * `:latest` and GitHub's Latest release follow the highest published version:
 * re-running the v0.5.78–v0.5.80 releases after v0.5.82 moved both back to
 * v0.5.79 (#4740). The decision is unit-tested here, then run the way the
 * Release workflow runs it: its real steps, from a checkout of the script
 * alone, against a stand-in `gh` that applies the real `jq`. The manifest
 * job's half of the chain runs in oci-image-metadata.test.ts.
 */

const repository = resolve(import.meta.dir, '../../..');
const SCRIPT = 'tools/cli/scripts/release-latest.ts';
const DECIDE = 'Decide whether this release moves latest';
const SOURCE_SHA = 'c'.repeat(40);
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const published = (tag: string, overrides: Partial<Release> = {}): Release => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: '2026-10-09T12:00:00Z',
  ...overrides,
});
// Published when v0.5.79 was re-run, in no particular order: the API's order
// is not the version order.
const incident = ['v0.5.80', 'v0.5.82', 'v0.5.78', 'v0.5.81'].map((tag) =>
  published(tag),
);

describe('latestDecision', () => {
  test.each(['v0.5.78', 'v0.5.79', 'v0.5.80'])(
    'a re-run of %s after v0.5.82 keeps both where they are',
    (version) => {
      expect(
        latestDecision({ version, sitesOnly: false, releases: incident }),
      ).toEqual({ move: false, reason: 'v0.5.82 is published and higher' });
    },
  );

  test('a new highest version moves both', () => {
    expect(
      latestDecision({
        version: 'v0.5.83',
        sitesOnly: false,
        releases: incident,
      }),
    ).toEqual({
      move: true,
      reason: 'v0.5.83 is at least as high as every published release',
    });
  });

  test('a re-run of the highest version moves both onto the index it rebuilt', () => {
    expect(
      latestDecision({
        version: 'v0.5.82',
        sitesOnly: false,
        releases: incident,
      }).move,
    ).toBe(true);
  });

  test('the first release moves both', () => {
    expect(
      latestDecision({ version: 'v0.1.0', sitesOnly: false, releases: [] })
        .move,
    ).toBe(true);
  });

  test('a sites-only run moves neither', () => {
    expect(
      latestDecision({ version: 'v0.5.83', sitesOnly: true, releases: [] }),
    ).toEqual({ move: false, reason: 'a sites-only run keeps both' });
  });

  test('a pre-release moves neither', () => {
    expect(
      latestDecision({
        version: 'v0.6.0-rc.1',
        sitesOnly: false,
        releases: incident,
      }),
    ).toEqual({ move: false, reason: 'v0.6.0-rc.1 is a pre-release' });
  });

  test('only a published stable release holds a version back', () => {
    const releases = [
      ...incident,
      published('v0.5.90', { draft: true, published_at: null }),
      published('v0.5.91', { published_at: null }),
      published('v0.6.0', { prerelease: true }),
      published('v0.7.0-rc.1'),
      published('ui-v9.9.9'),
      published('nightly'),
    ];
    expect(
      latestDecision({ version: 'v0.5.83', sitesOnly: false, releases }).move,
    ).toBe(true);
  });

  test('versions compare by number, not as text', () => {
    const moves = (version: string, tag: string) =>
      latestDecision({ version, sitesOnly: false, releases: [published(tag)] })
        .move;
    expect(moves('v0.5.99', 'v0.5.100')).toBe(false);
    expect(moves('v0.5.100', 'v0.5.99')).toBe(true);
    expect(moves('v0.9.9', 'v0.10.0')).toBe(false);
    expect(moves('v1.0.0', 'v0.10.0')).toBe(true);
  });

  test.each([
    '',
    'latest',
    'v0.5',
    'V0.5.82',
    'v0.5.82.1',
    'v0.5.82 ',
    'v0.5.82\nv9.9.9',
  ])('refuses %j as a version, even for a sites-only run', (version) => {
    expect(() =>
      latestDecision({ version, sitesOnly: true, releases: [] }),
    ).toThrow('is not an exact version such as v1.2.3');
  });
});

describe('parseRelease', () => {
  test('reads one line of the projection', () => {
    expect(
      parseRelease('["v0.5.82",false,false,"2026-10-09T12:00:00Z"]'),
    ).toEqual(published('v0.5.82'));
    expect(parseRelease('["v0.6.0",true,false,null]')).toEqual(
      published('v0.6.0', { draft: true, published_at: null }),
    );
  });

  test.each([
    'not json',
    '{}',
    '[]',
    '["v0.5.82",false,false]',
    '["v0.5.82",false,false,null,"extra"]',
    '["v0.5.82","false",false,null]',
    '[582,false,false,null]',
    '["v0.5.82",false,false,0]',
  ])('refuses %j', (line) => {
    expect(() => parseRelease(line)).toThrow();
  });
});

/** The fields a release has in the API, beyond the ones the decision reads. */
const api = (release: Release) => ({
  ...release,
  name: `Tale ${release.tag_name}`,
  target_commitish: 'main',
  body: '## Highlights\n\nTwo paragraphs, one record.',
});

/**
 * A checkout of the script alone, as each job's sparse checkout has it, and a
 * stand-in `gh` that records each call. It answers `gh api --paginate --jq`
 * as gh does, with the query applied by the real `jq` to every page.
 */
async function fixture(pages: readonly (readonly Release[])[]) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-release-latest-'));
  temporary.push(directory);
  await mkdir(join(directory, 'checkout', dirname(SCRIPT)), {
    recursive: true,
  });
  await copyFile(join(repository, SCRIPT), join(directory, 'checkout', SCRIPT));
  for (const [index, page] of (pages.length ? pages : [[]]).entries())
    await writeFile(
      join(directory, `page-${index + 1}.json`),
      JSON.stringify(page.map(api)),
    );
  await writeFile(join(directory, 'output'), '');
  await mkdir(join(directory, 'bin'));
  await writeFile(
    join(directory, 'bin/gh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t' "$@" >> "$STATE/gh-calls"
printf '\\n' >> "$STATE/gh-calls"
case "$1 \${2:-}" in
  'api --paginate')
    if [ -e "$STATE/unreadable" ]; then echo 'HTTP 502: Bad Gateway' >&2; exit 1; fi
    for page in "$STATE"/page-*.json; do jq -r "$5" "$page"; done ;;
  'api repos/'*) echo "$SOURCE_SHA" ;;
  'release view') exit 1 ;;
  'release create') ;;
  *) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
`,
  );
  await chmod(join(directory, 'bin/gh'), 0o755);
  return directory;
}

/** Runs `command` in the fixture's checkout with the stand-in `gh` first. */
async function run(
  directory: string,
  command: string[],
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(command, {
    cwd: join(directory, 'checkout'),
    env: {
      PATH: [
        join(directory, 'bin'),
        dirname(process.execPath),
        process.env.PATH,
      ].join(delimiter),
      HOME: directory,
      STATE: directory,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function ghCalls(directory: string) {
  const file = join(directory, 'gh-calls');
  if (!existsSync(file)) return [];
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/\t$/, '').split('\t'));
}

describe('the release-latest command', () => {
  const decide = (directory: string, ...args: string[]) =>
    run(directory, [process.execPath, SCRIPT, ...args]);

  test.skipIf(process.platform === 'win32')(
    'reads every page of releases and prints the decision',
    async () => {
      const directory = await fixture([
        incident.slice(0, 2),
        incident.slice(2),
      ]);
      const older = await decide(
        directory,
        '--repo',
        'tale-project/tale',
        '--version',
        'v0.5.79',
        '--sites-only',
        'false',
      );
      expect(older.code, older.stderr).toBe(0);
      expect(older.stdout).toBe('false\n');
      expect(older.stderr).toContain(
        'Keeps :latest and GitHub Latest: v0.5.82 is published and higher',
      );
      expect(await ghCalls(directory)).toEqual([
        [
          'api',
          '--paginate',
          'repos/tale-project/tale/releases?per_page=100',
          '--jq',
          RELEASE_FIELDS,
        ],
      ]);
      const newer = await decide(directory, '--version', 'v0.5.83');
      expect(newer.code, newer.stderr).toBe(0);
      expect(newer.stdout).toBe('true\n');
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a sites-only run decides without reading the releases',
    async () => {
      const directory = await fixture([incident]);
      const result = await decide(
        directory,
        '--version',
        'v0.5.83',
        '--sites-only',
        'true',
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe('false\n');
      expect(await ghCalls(directory)).toEqual([]);
    },
  );

  test.skipIf(process.platform === 'win32').each([
    ['an unreadable release history', 'HTTP 502: Bad Gateway', true],
    ['a release record of another shape', 'Unexpected release record', false],
  ])('%s decides nothing', async (_label, message, unreadable) => {
    const directory = await fixture([
      [
        ...incident,
        { ...published('v0.5.83'), draft: 'no' as unknown as boolean },
      ],
    ]);
    if (unreadable) await writeFile(join(directory, 'unreadable'), '');
    const result = await decide(directory, '--version', 'v0.5.83');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
  });

  test
    .skipIf(process.platform === 'win32')
    .each([
      [[]],
      [['--version', 'latest']],
      [['--version', 'v0.5.83', '--sites-only', 'yes']],
      [['--version', 'v0.5.83', '--repo', 'tale-project']],
      [['--version', 'v0.5.83', '--latest', 'true']],
    ])('refuses the arguments %j', async (args) => {
    const directory = await fixture([incident]);
    const result = await decide(directory, ...args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'usage: bun tools/cli/scripts/release-latest.ts',
    );
    expect(await ghCalls(directory)).toEqual([]);
  });
});

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: unknown;
};
type Workflow = {
  jobs: Record<
    string,
    { permissions?: Record<string, string>; steps?: Step[] }
  >;
};

async function releaseWorkflow(): Promise<Workflow> {
  return parse(
    await readFile(join(repository, '.github/workflows/release.yml'), 'utf8'),
  ) as Workflow;
}

function step(file: Workflow, job: string, name: string): Step {
  const found = file.jobs[job]?.steps?.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${job}: ${name}`);
  return found;
}

describe('the Release workflow decides when it writes', () => {
  // Each job that moves one of the two marks, and the step that moves it.
  const WRITERS: Record<string, string> = {
    manifest: 'Create and push the OCI image index',
    'create-release': 'Create release',
  };

  test('each writing job runs the same decision from its own checkout, just before it writes', async () => {
    const file = await releaseWorkflow();
    const [manifest, creation] = Object.keys(WRITERS).map((job) =>
      step(file, job, DECIDE),
    );
    expect(creation).toEqual(manifest!);
    expect(manifest!.id).toBe('latest');
    expect(manifest!['continue-on-error']).toBeUndefined();
    expect(manifest!.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      REPOSITORY: '${{ github.repository }}',
      TAG: '${{ needs.prepare.outputs.version }}',
      SITES_ONLY: '${{ needs.prepare.outputs.sites_only }}',
    });
    for (const [job, writer] of Object.entries(WRITERS)) {
      const steps = file.jobs[job]!.steps!;
      const checkout = steps.findIndex((entry) =>
        entry.uses?.startsWith('actions/checkout@'),
      );
      const bun = steps.findIndex((entry) =>
        entry.uses?.startsWith('oven-sh/setup-bun@'),
      );
      const decision = steps.findIndex((entry) => entry.name === DECIDE);
      const write = steps.findIndex((entry) => entry.name === writer);
      expect(
        [checkout, bun, decision, write].every((index) => index >= 0) &&
          checkout < bun &&
          bun < decision &&
          decision < write,
        job,
      ).toBe(true);
      expect(
        String(steps[checkout]!.with?.['sparse-checkout']).trim().split('\n'),
        job,
      ).toContain(SCRIPT);
      expect(steps[checkout]!.with?.['persist-credentials'], job).toBe(false);
      // The writer reads the decision alone, and never runs after a failed one.
      expect(steps[write]!.env?.MOVE_LATEST, job).toBe(
        '${{ steps.latest.outputs.move }}',
      );
      expect(steps[write]!.env?.SITES_ONLY, job).toBeUndefined();
      expect(steps[write]!.if, job).toBeUndefined();
    }
    // A manifest leg checks out the script alone, and may read the releases.
    expect(
      String(
        step(file, 'manifest', 'Checkout the latest decision').with?.[
          'sparse-checkout'
        ],
      )
        .trim()
        .split('\n'),
    ).toEqual([SCRIPT]);
    expect(file.jobs.manifest!.permissions).toEqual({
      contents: 'read',
      packages: 'write',
    });
    expect(step(file, 'create-release', 'Create release').run).toContain(
      '--latest="$MOVE_LATEST"',
    );
  });

  test.skipIf(process.platform === 'win32').each([
    ['a re-run of v0.5.79 after v0.5.82', 'false', 'v0.5.79'],
    ['the new highest v0.5.83', 'true', 'v0.5.83'],
  ])(
    'create-release creates %s with --latest=%s',
    async (_label, latest, tag) => {
      const file = await releaseWorkflow();
      const directory = await fixture([
        incident.slice(0, 2),
        incident.slice(2),
      ]);
      const env = {
        GH_TOKEN: 'stand-in',
        REPOSITORY: 'tale-project/tale',
        TAG: tag,
        SITES_ONLY: 'false',
        SOURCE_SHA,
        GITHUB_OUTPUT: join(directory, 'output'),
      };
      const decided = await run(
        directory,
        ['bash', '-e', '-c', step(file, 'create-release', DECIDE).run!],
        env,
      );
      expect(decided.code, decided.stderr).toBe(0);
      const output = await readFile(join(directory, 'output'), 'utf8');
      expect(output).toBe(`move=${latest}\n`);
      const created = await run(
        directory,
        [
          'bash',
          '-e',
          '-c',
          step(file, 'create-release', 'Create release').run!,
        ],
        { ...env, MOVE_LATEST: /^move=(.*)$/m.exec(output)![1]! },
      );
      expect(created.code, created.stderr).toBe(0);
      const creations = (await ghCalls(directory)).filter(
        (call) => call[0] === 'release' && call[1] === 'create',
      );
      expect(creations).toHaveLength(1);
      expect(
        creations[0]!.filter((argument) => argument.startsWith('--latest')),
      ).toEqual([`--latest=${latest}`]);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'an unreadable release history fails the decision before anything is written',
    async () => {
      const directory = await fixture([incident]);
      await writeFile(join(directory, 'unreadable'), '');
      const decided = await run(
        directory,
        [
          'bash',
          '-e',
          '-c',
          step(await releaseWorkflow(), 'create-release', DECIDE).run!,
        ],
        {
          GH_TOKEN: 'stand-in',
          REPOSITORY: 'tale-project/tale',
          TAG: 'v0.5.83',
          SITES_ONLY: 'false',
          GITHUB_OUTPUT: join(directory, 'output'),
        },
      );
      expect(decided.code).not.toBe(0);
      expect(await readFile(join(directory, 'output'), 'utf8')).toBe('');
    },
  );
});
