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
  parseRelease,
  sourceDecision,
  tagNames,
  type Release,
  type Tag,
} from './release-source';

/**
 * A Release run publishes only the commit its version's tag names, and a
 * published release's tag never moves: v0.5.82 was published from 81ef78dcd,
 * then its tag moved twice and two more runs rebuilt its images, the last its
 * CLI too, from the newer commits under the first run's notes (#4741). The
 * decision is
 * unit-tested here, then run the way the Release workflow runs it: its real
 * step, from a checkout of the script alone, against a stand-in `gh` that
 * applies the real `jq`.
 */

const repository = resolve(import.meta.dir, '../../..');
const SCRIPT = 'tools/cli/scripts/release-source.ts';
const GUARD = 'Refuse a moved release tag';
// v0.5.82's three Release runs: the dispatched 37997069367 published the
// release from FIRST, then 37998909930 and 38001085799 ran for the tag moved
// to SECOND and THIRD.
const FIRST = '81ef78dcd1363c3aef04b6e8b92c9780c99e11f7';
const SECOND = 'e6fb96249d43494dc82922995615b525cdc0f5c3';
const THIRD = '0381bc439d9de85079bcdd4e001ad7e989f76bb9';
const SOURCE = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const published = (
  tag: string,
  target: string,
  overrides: Partial<Release> = {},
): Release => ({
  tag_name: tag,
  draft: false,
  target_commitish: target,
  published_at: '2026-10-09T22:13:25Z',
  ...overrides,
});
const tag = (name: string, commit: string): Tag => ({ name, commit });
const NEXT_VERSION =
  "a published release's tag never moves, so release this commit as the next version";

describe('sourceDecision', () => {
  test.each([SECOND, THIRD])(
    'a run for the v0.5.82 tag moved to %s refuses',
    (source) => {
      const tags = [tag('v0.5.82', source)];
      // As v0.5.82 was published: against main, by the release.yml of then.
      expect(
        sourceDecision({
          version: 'v0.5.82',
          source,
          tags,
          releases: [published('v0.5.82', 'main')],
        }),
      ).toEqual({
        proceed: false,
        reason: `v0.5.82 was published against main, not a commit, so nothing shows it came from this run's commit ${source}: ${NEXT_VERSION}`,
      });
      // As Create release records it now: the commit it passed as --target.
      expect(
        sourceDecision({
          version: 'v0.5.82',
          source,
          tags,
          releases: [published('v0.5.82', FIRST)],
        }),
      ).toEqual({
        proceed: false,
        reason: `v0.5.82 was published from ${FIRST}, not this run's commit ${source}: ${NEXT_VERSION}`,
      });
    },
  );

  test('a re-run of the commit a release was published from proceeds', () => {
    expect(
      sourceDecision({
        version: 'v0.5.82',
        source: THIRD,
        tags: [tag('v0.5.82', THIRD)],
        releases: [published('v0.5.81', FIRST), published('v0.5.82', THIRD)],
      }),
    ).toEqual({
      proceed: true,
      reason: `v0.5.82 was published from this run's commit ${THIRD}`,
    });
  });

  test('a run of a commit its tag does not name refuses, published or not', () => {
    // A version dispatch on main builds main's head, not the tagged commit.
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [tag('v0.5.95', OTHER)],
        releases: [],
      }),
    ).toEqual({
      proceed: false,
      reason: `The tag v0.5.95 names ${OTHER}, not this run's commit ${SOURCE}: a Release run publishes only the commit its tag names`,
    });
    expect(
      sourceDecision({
        version: 'v0.5.82',
        source: FIRST,
        tags: [tag('v0.5.82', THIRD)],
        releases: [published('v0.5.82', FIRST)],
      }).proceed,
    ).toBe(false);
  });

  test('either spelling of the tag and of the release counts', () => {
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [tag('v0.5.95', SOURCE), tag('0.5.95', OTHER)],
        releases: [],
      }).reason,
    ).toBe(
      `The tag 0.5.95 names ${OTHER}, not this run's commit ${SOURCE}: a Release run publishes only the commit its tag names`,
    );
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [tag('0.5.95', SOURCE)],
        releases: [published('0.5.95', OTHER)],
      }).reason,
    ).toBe(
      `0.5.95 was published from ${OTHER}, not this run's commit ${SOURCE}: ${NEXT_VERSION}`,
    );
  });

  test('a version without a published release proceeds', () => {
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [],
        releases: [],
      }),
    ).toEqual({
      proceed: true,
      reason: 'v0.5.95 has no tag and no published release yet',
    });
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [tag('v0.5.95', SOURCE), tag('0.5.95', SOURCE)],
        releases: [],
      }),
    ).toEqual({
      proceed: true,
      reason: `v0.5.95 names this run's commit ${SOURCE} and has no published release`,
    });
  });

  test('only a published release of this version holds its commit', () => {
    expect(
      sourceDecision({
        version: 'v0.5.95',
        source: SOURCE,
        tags: [tag('v0.5.950', OTHER), tag('v0.5.95-rc.1', OTHER)],
        releases: [
          published('v0.5.95', OTHER, { draft: true, published_at: null }),
          published('v0.5.95', OTHER, { published_at: null }),
          published('v0.5.94', OTHER),
          published('v0.5.950', OTHER),
          published('v0.5.95-rc.1', OTHER),
          published('ui-v0.5.95', OTHER),
        ],
      }),
    ).toEqual({
      proceed: true,
      reason: 'v0.5.95 has no tag and no published release yet',
    });
  });

  test.each([
    '',
    'latest',
    '0.5.82',
    'V0.5.82',
    'v0.5',
    'v0.5.82.1',
    'v0.5.82 ',
    'v0.5.82\nv9.9.9',
  ])('refuses %j as a version', (version) => {
    expect(() =>
      sourceDecision({ version, source: SOURCE, tags: [], releases: [] }),
    ).toThrow('is not an exact version such as v1.2.3');
  });

  test.each([
    '',
    'main',
    'v0.5.82',
    '0381bc439',
    THIRD.toUpperCase(),
    `${THIRD}0`,
  ])('refuses %j as the source', (source) => {
    expect(() =>
      sourceDecision({ version: 'v0.5.82', source, tags: [], releases: [] }),
    ).toThrow('is not a full commit SHA');
  });

  test('a version is read in both spellings', () => {
    expect(tagNames('v0.5.82')).toEqual(['v0.5.82', '0.5.82']);
    expect(tagNames('v0.6.0-rc.1')).toEqual(['v0.6.0-rc.1', '0.6.0-rc.1']);
  });
});

describe('parseRelease', () => {
  test('reads one line of the projection', () => {
    expect(
      parseRelease('["v0.5.82",false,"main","2026-10-09T22:13:25Z"]'),
    ).toEqual(published('v0.5.82', 'main'));
    expect(parseRelease(`["v0.6.0",true,"${SOURCE}",null]`)).toEqual(
      published('v0.6.0', SOURCE, { draft: true, published_at: null }),
    );
  });

  test.each([
    'not json',
    '{}',
    '[]',
    '["v0.5.82",false,"main"]',
    '["v0.5.82",false,"main",null,"extra"]',
    '["v0.5.82","false","main",null]',
    '["v0.5.82",false,null,null]',
    '[582,false,"main",null]',
    '["v0.5.82",false,"main",0]',
  ])('refuses %j', (line) => {
    expect(() => parseRelease(line)).toThrow();
  });
});

/** A tag in the fixture: `object` is the tag object of an annotated tag. */
type FixtureTag = { name: string; commit: string | null; object?: string };

/** The fields a release has in the API, beyond the ones the decision reads. */
const api = (release: Release) => ({
  ...release,
  prerelease: false,
  name: `Tale ${release.tag_name}`,
  body: '## Highlights\n\nTwo paragraphs, one record.',
});

/**
 * A checkout of the script alone, as each job's sparse checkout has it, and a
 * stand-in `gh` that records each call. It answers as the API does: the tags
 * whose ref starts with the name (`git/matching-refs`), the commit behind a
 * tag (`commits/<ref>`, 422 for none), and the releases a page at a time,
 * each with the query applied by the real `jq`. A `commit` of `null` is a
 * tag that went away between the two reads.
 */
async function fixture(
  tags: readonly FixtureTag[],
  pages: readonly (readonly Release[])[],
) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-release-source-'));
  temporary.push(directory);
  await mkdir(join(directory, 'checkout', dirname(SCRIPT)), {
    recursive: true,
  });
  await copyFile(join(repository, SCRIPT), join(directory, 'checkout', SCRIPT));
  await writeFile(
    join(directory, 'refs.json'),
    JSON.stringify(
      tags.map((entry) => ({
        ref: `refs/tags/${entry.name}`,
        object: entry.object
          ? { sha: entry.object, type: 'tag' }
          : { sha: entry.commit, type: 'commit' },
        peeled: entry.commit,
      })),
    ),
  );
  for (const [index, page] of (pages.length ? pages : [[]]).entries())
    await writeFile(
      join(directory, `page-${index + 1}.json`),
      JSON.stringify(page.map(api)),
    );
  await mkdir(join(directory, 'bin'));
  await writeFile(
    join(directory, 'bin/gh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t' "$@" >> "$STATE/gh-calls"
printf '\\n' >> "$STATE/gh-calls"
if [ -e "$STATE/unreadable" ] && [[ "$*" == *"$(cat "$STATE/unreadable")"* ]]; then
  echo 'HTTP 502: Bad Gateway' >&2; exit 1
fi
case "$*" in
  'api --paginate repos/'*'/git/matching-refs/tags/'*)
    PREFIX="refs/tags/\${3##*/git/matching-refs/tags/}"
    jq -c --arg prefix "$PREFIX" '[.[] | select(.ref | startswith($prefix)) | del(.peeled)]' "$STATE/refs.json" | jq -r "$5" ;;
  'api repos/'*'/commits/'*)
    REF="\${2##*/commits/}"
    REF="\${REF//%2F//}"
    jq -ce --arg ref "$REF" '.[] | select(.ref == $ref and .peeled != null) | {sha: .peeled}' "$STATE/refs.json" | jq -r "$4" \\
      || { echo "HTTP 422: No commit found for SHA: $REF" >&2; exit 1; } ;;
  'api --paginate repos/'*'/releases?per_page=100 '*)
    for page in "$STATE"/page-*.json; do jq -r "$5" "$page"; done ;;
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

const reads = (name: string, peeled: boolean) => [
  [
    'api',
    '--paginate',
    `repos/tale-project/tale/git/matching-refs/tags/${name}`,
    '--jq',
    '.[].ref',
  ],
  ...(peeled
    ? [
        [
          'api',
          `repos/tale-project/tale/commits/refs%2Ftags%2F${name}`,
          '--jq',
          '.sha',
        ],
      ]
    : []),
];
const RELEASES = [
  'api',
  '--paginate',
  'repos/tale-project/tale/releases?per_page=100',
  '--jq',
  RELEASE_FIELDS,
];

// v0.5.82 as published, among the releases around it, over two pages.
const history = [
  [published('v0.5.81', 'main'), published('v0.5.82', FIRST)],
  [published('v0.5.80', 'main'), published('v0.5.95', SOURCE)],
];

describe('the release-source command', () => {
  const decide = (directory: string, ...args: string[]) =>
    run(directory, [process.execPath, SCRIPT, ...args]);

  test.skipIf(process.platform === 'win32')(
    'refuses the moved v0.5.82 tag, naming both commits',
    async () => {
      const directory = await fixture(
        [{ name: 'v0.5.82', commit: THIRD }],
        history,
      );
      const result = await decide(
        directory,
        '--repo',
        'tale-project/tale',
        '--version',
        'v0.5.82',
        '--source',
        THIRD,
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        `::error::v0.5.82 was published from ${FIRST}, not this run's commit ${THIRD}: ${NEXT_VERSION}\n`,
      );
      expect(await ghCalls(directory)).toEqual([
        ...reads('v0.5.82', true),
        ...reads('0.5.82', false),
        RELEASES,
      ]);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'proceeds for the commit the release was published from',
    async () => {
      const directory = await fixture(
        [
          { name: 'v0.5.95', commit: SOURCE },
          { name: '0.5.95', commit: SOURCE, object: OTHER },
        ],
        history,
      );
      const result = await decide(
        directory,
        '--version',
        'v0.5.95',
        '--source',
        SOURCE,
      );
      expect(result.code, result.stderr).toBe(0);
      // The annotated 0.5.95 is read through its tag object to its commit.
      expect(result.stdout).toBe(
        `Publishes ${SOURCE} as v0.5.95: v0.5.95 was published from this run's commit ${SOURCE}\n`,
      );
      expect(await ghCalls(directory)).toEqual([
        ...reads('v0.5.95', true),
        ...reads('0.5.95', true),
        RELEASES,
      ]);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'reads each spelling exactly, not the tags its name prefixes',
    async () => {
      const directory = await fixture(
        [
          { name: 'v0.5.960', commit: OTHER },
          { name: 'v0.5.96-rc.1', commit: OTHER },
          { name: '0.5.96-rc.1', commit: OTHER },
        ],
        history,
      );
      const free = await decide(
        directory,
        '--version',
        'v0.5.96',
        '--source',
        SOURCE,
      );
      expect(free.code, free.stderr).toBe(0);
      expect(free.stdout).toBe(
        `Publishes ${SOURCE} as v0.5.96: v0.5.96 has no tag and no published release yet\n`,
      );
      expect(await ghCalls(directory)).toEqual([
        ...reads('v0.5.96', false),
        ...reads('0.5.96', false),
        RELEASES,
      ]);
      const taken = await fixture([{ name: '0.5.96', commit: OTHER }], history);
      const refused = await decide(
        taken,
        '--version',
        'v0.5.96',
        '--source',
        SOURCE,
      );
      expect(refused.code).toBe(1);
      expect(refused.stderr).toBe(
        `::error::The tag 0.5.96 names ${OTHER}, not this run's commit ${SOURCE}: a Release run publishes only the commit its tag names\n`,
      );
    },
  );

  test.skipIf(process.platform === 'win32').each([
    [
      'unreadable tags',
      [{ name: 'v0.5.96', commit: SOURCE }],
      'git/matching-refs',
      'gh api repos/tale-project/tale/git/matching-refs/tags/v0.5.96 failed: HTTP 502: Bad Gateway',
    ],
    [
      'an unreadable release history',
      [],
      'releases',
      'gh api repos/tale-project/tale/releases?per_page=100 failed: HTTP 502: Bad Gateway',
    ],
    [
      'a tag gone between the reads',
      [{ name: 'v0.5.96', commit: null }],
      '',
      'gh api repos/tale-project/tale/commits/refs%2Ftags%2Fv0.5.96 failed: HTTP 422: No commit found for SHA: refs/tags/v0.5.96',
    ],
    [
      'a tag commit that is not a SHA',
      [{ name: 'v0.5.96', commit: 'main' }],
      '',
      'Unexpected commit for refs/tags/v0.5.96: main',
    ],
  ] as const)(
    '%s decide nothing',
    async (_label, tags, unreadable, message) => {
      const directory = await fixture(tags, history);
      if (unreadable)
        await writeFile(join(directory, 'unreadable'), unreadable);
      const result = await decide(
        directory,
        '--version',
        'v0.5.96',
        '--source',
        SOURCE,
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      // A workflow command escapes `%`; the runner shows the path as read.
      expect(result.stderr).toBe(
        `::error::release-source: ${message.replaceAll('%', '%25')}\n`,
      );
    },
  );

  test.skipIf(process.platform === 'win32')(
    'a release record of another shape decides nothing',
    async () => {
      const directory = await fixture(
        [],
        [[published('v0.5.96', SOURCE, { draft: 'no' as unknown as boolean })]],
      );
      const result = await decide(
        directory,
        '--version',
        'v0.5.96',
        '--source',
        SOURCE,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toStartWith(
        '::error::release-source: Unexpected release record: ',
      );
    },
  );

  test
    .skipIf(process.platform === 'win32')
    .each([
      [[]],
      [['--version', 'v0.5.96']],
      [['--source', SOURCE]],
      [['--version', '0.5.96', '--source', SOURCE]],
      [['--version', 'v0.5.96', '--source', '0381bc439']],
      [['--version', 'v0.5.96', '--source', SOURCE, '--repo', 'tale-project']],
      [['--version', 'v0.5.96', '--source', SOURCE, '--sites-only', 'true']],
    ])('refuses the arguments %j', async (args) => {
    const directory = await fixture([], history);
    const result = await decide(directory, ...args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'usage: bun tools/cli/scripts/release-source.ts',
    );
    expect(await ghCalls(directory)).toEqual([]);
  });

  test('imports nothing but Node built-ins, so a sparse checkout of it runs', async () => {
    const imports = new Bun.Transpiler({ loader: 'ts' })
      .scanImports(await readFile(join(repository, SCRIPT), 'utf8'))
      .map((entry) => entry.path);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toStartWith('node:');
  });
});

type Step = {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: unknown;
};
type Workflow = {
  jobs: Record<string, { if?: string; steps?: Step[] }>;
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

describe('the Release workflow refuses a moved tag before it publishes', () => {
  // Each job the decision guards, and the step it immediately precedes:
  // Prepare's before any image builds, then each step that writes under the
  // version (a failed-jobs re-run keeps Prepare's outputs, and a tag can
  // move while images build).
  const BEFORE: Record<string, string> = {
    prepare: 'Validate authored release notes before building',
    manifest: 'Create and push the OCI image index',
    'create-release': 'Create release',
    'trigger-cli': 'Dispatch CLI workflow',
  };
  const RUN =
    'bun tools/cli/scripts/release-source.ts --repo "$REPOSITORY" --version "$TAG" --source "$SOURCE_SHA"';

  test('each guarded job runs the same decision from its own checkout, just before it writes', async () => {
    const file = await releaseWorkflow();
    expect(
      Object.entries(file.jobs)
        .filter(([, job]) => job.steps?.some((entry) => entry.name === GUARD))
        .map(([name]) => name),
    ).toEqual(Object.keys(BEFORE));
    for (const [job, before] of Object.entries(BEFORE)) {
      const steps = file.jobs[job]!.steps!;
      const checkout = steps.findIndex((entry) =>
        entry.uses?.startsWith('actions/checkout@'),
      );
      const bun = steps.findIndex((entry) =>
        entry.uses?.startsWith('oven-sh/setup-bun@'),
      );
      const guard = steps.findIndex((entry) => entry.name === GUARD);
      const next = steps.findIndex((entry) => entry.name === before);
      expect(
        [checkout, bun, guard, next].every((index) => index >= 0) &&
          checkout < bun &&
          bun < guard &&
          guard + 1 === next,
        job,
      ).toBe(true);
      const { with: options } = steps[checkout]!;
      expect(
        String(options?.['sparse-checkout']).trim().split('\n'),
        job,
      ).toContain(SCRIPT);
      expect(options?.['sparse-checkout-cone-mode'], job).toBe(false);
      expect(options?.['persist-credentials'], job).toBe(false);
      expect(steps[guard]!.run, job).toBe(RUN);
      expect(steps[guard]!['continue-on-error'], job).toBeUndefined();
      const outputs =
        job === 'prepare' ? 'steps.version.outputs' : 'needs.prepare.outputs';
      expect(steps[guard]!.env, job).toEqual({
        GH_TOKEN: '${{ github.token }}',
        REPOSITORY: '${{ github.repository }}',
        TAG: `\${{ ${outputs}.version }}`,
        SOURCE_SHA: `\${{ ${outputs}.source_sha }}`,
      });
      // A sites-only run rebuilds the sites of a version from a newer
      // commit, and never reaches the jobs that skip it.
      const sitesOnly = `${outputs}.sites_only != 'true'`;
      if (job === 'prepare' || job === 'manifest')
        expect(steps[guard]!.if, job).toBe(sitesOnly);
      else {
        expect(steps[guard]!.if, job).toBeUndefined();
        expect(file.jobs[job]!.if, job).toBe(sitesOnly);
      }
      // What follows the decision never runs after a failed one.
      expect(steps[next]!.if, job).toBe(
        job === 'prepare' ? sitesOnly : undefined,
      );
    }
    expect(
      String(
        step(file, 'trigger-cli', 'Checkout the source decision').with?.[
          'sparse-checkout'
        ],
      )
        .trim()
        .split('\n'),
    ).toEqual([SCRIPT]);
  });

  test.skipIf(process.platform === 'win32').each(Object.keys(BEFORE))(
    "%s's step refuses the moved v0.5.82 tag and proceeds for the published commit",
    async (job) => {
      const run_ = step(await releaseWorkflow(), job, GUARD).run!;
      const env = {
        GH_TOKEN: 'stand-in',
        REPOSITORY: 'tale-project/tale',
        TAG: 'v0.5.82',
      };
      const moved = await fixture(
        [{ name: 'v0.5.82', commit: THIRD }],
        history,
      );
      const refused = await run(moved, ['bash', '-e', '-c', run_], {
        ...env,
        SOURCE_SHA: THIRD,
      });
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(
        `::error::v0.5.82 was published from ${FIRST}, not this run's commit ${THIRD}`,
      );
      const kept = await fixture([{ name: 'v0.5.82', commit: FIRST }], history);
      const proceeded = await run(kept, ['bash', '-e', '-c', run_], {
        ...env,
        SOURCE_SHA: FIRST,
      });
      expect(proceeded.code, proceeded.stderr).toBe(0);
      expect(proceeded.stdout).toBe(
        `Publishes ${FIRST} as v0.5.82: v0.5.82 was published from this run's commit ${FIRST}\n`,
      );
    },
  );
});
