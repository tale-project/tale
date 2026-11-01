/**
 * Whether a Release run may publish its commit as its version: only when
 * each tag of the version names that commit, and no published release of the
 * version came from another. v0.5.82 was published from 81ef78dcd; its tag
 * then moved twice, and two more runs rebuilt its images, the last its CLI
 * too, from newer commits under the notes of the first (#4741). A published
 * release's tag never moves: a newer commit is released as the next version.
 * Dependency-free: the release jobs run it from a sparse checkout.
 */
import { parseArgs } from 'node:util';

/** The fields of a GitHub release the decision reads. */
export type Release = {
  tag_name: string;
  draft: boolean;
  /** The full SHA `Create release` passes as `--target`. */
  target_commitish: string;
  published_at: string | null;
};

/** A tag of the version that exists, and the commit it names. */
export type Tag = { name: string; commit: string };

const VERSION = /^v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** `gh api --jq` projection: one JSON line per release, the fields above. */
export const RELEASE_FIELDS =
  '.[] | [.tag_name, .draft, .target_commitish, .published_at] | @json';

/**
 * The two spellings of the version's tag, `vX.Y.Z` and `X.Y.Z`: Release
 * publishes the same images for both, so either one names the version.
 */
export function tagNames(version: string): [string, string] {
  const number = VERSION.exec(version)?.[1];
  if (!number)
    throw new Error(`${version} is not an exact version such as v1.2.3`);
  return [version, number];
}

/**
 * Proceeds only when each tag of the version names `source` and each
 * published release of the version was published from it. A release
 * published against a branch, as v0.5.84 and older were, names no commit, so
 * it refuses every source. Drafts are not published; the version is free
 * until a release is.
 */
export function sourceDecision({
  version,
  source,
  tags,
  releases,
}: {
  version: string;
  source: string;
  tags: readonly Tag[];
  releases: readonly Release[];
}): { proceed: boolean; reason: string } {
  const names: readonly string[] = tagNames(version);
  if (!COMMIT.test(source))
    throw new Error(`${source} is not a full commit SHA`);
  const ours = tags.filter((tag) => names.includes(tag.name));
  const moved = ours.find((tag) => tag.commit !== source);
  if (moved)
    return {
      proceed: false,
      reason: `The tag ${moved.name} names ${moved.commit}, not this run's commit ${source}: a Release run publishes only the commit its tag names`,
    };
  const published = releases.filter(
    (release) =>
      names.includes(release.tag_name) &&
      !release.draft &&
      release.published_at !== null,
  );
  const other = published.find(
    (release) => release.target_commitish !== source,
  );
  if (other) {
    const target = other.target_commitish;
    const from = COMMIT.test(target)
      ? `was published from ${target}, not this run's commit ${source}`
      : `was published against ${target}, not a commit, so nothing shows it came from this run's commit ${source}`;
    return {
      proceed: false,
      reason: `${other.tag_name} ${from}: a published release's tag never moves, so release this commit as the next version`,
    };
  }
  if (published.length > 0)
    return {
      proceed: true,
      reason: `${version} was published from this run's commit ${source}`,
    };
  return {
    proceed: true,
    reason:
      ours.length > 0
        ? `${version} names this run's commit ${source} and has no published release`
        : `${version} has no tag and no published release yet`,
  };
}

/** One line of {@link RELEASE_FIELDS}, refused unless it has their shape. */
export function parseRelease(line: string): Release {
  const fields: unknown = JSON.parse(line);
  if (
    Array.isArray(fields) &&
    fields.length === 4 &&
    typeof fields[0] === 'string' &&
    typeof fields[1] === 'boolean' &&
    typeof fields[2] === 'string' &&
    (fields[3] === null || typeof fields[3] === 'string')
  ) {
    const [tag_name, draft, target_commitish, published_at] = fields;
    return { tag_name, draft, target_commitish, published_at };
  }
  throw new Error(`Unexpected release record: ${line}`);
}

/** What `gh api` prints for `args` (GH_TOKEN), or a thrown error. */
async function api(args: string[]): Promise<string> {
  const child = Bun.spawn(['gh', 'api', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    const path = args.find((argument) => argument.startsWith('repos/'));
    throw new Error(`gh api ${path} failed: ${stderr.trim()}`);
  }
  return stdout;
}

/** The tags of the version that exist, in both spellings, and their commits. */
async function readTags(repo: string, version: string): Promise<Tag[]> {
  const tags: Tag[] = [];
  for (const name of tagNames(version)) {
    // A prefix match, which answers an empty list for a missing tag where
    // git/ref answers 404.
    const refs = await api([
      '--paginate',
      `repos/${repo}/git/matching-refs/tags/${name}`,
      '--jq',
      '.[].ref',
    ]);
    if (!refs.split('\n').includes(`refs/tags/${name}`)) continue;
    // The commit, also behind an annotated tag.
    const commit = (
      await api([`repos/${repo}/commits/refs%2Ftags%2F${name}`, '--jq', '.sha'])
    ).trim();
    if (!COMMIT.test(commit))
      throw new Error(`Unexpected commit for refs/tags/${name}: ${commit}`);
    tags.push({ name, commit });
  }
  return tags;
}

/** Every release of the repository, read with `gh api` (GH_TOKEN). */
async function readReleases(repo: string): Promise<Release[]> {
  const stdout = await api([
    '--paginate',
    `repos/${repo}/releases?per_page=100`,
    '--jq',
    RELEASE_FIELDS,
  ]);
  return stdout.split('\n').filter(Boolean).map(parseRelease);
}

/** An error annotation on the run, escaped as workflow commands require. */
function annotate(message: string) {
  console.error(
    `::error::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`,
  );
}

function usage(message: string): never {
  console.error(`release-source: ${message}`);
  console.error(
    'usage: bun tools/cli/scripts/release-source.ts --version vX.Y.Z --source <full commit SHA> [--repo owner/name]',
  );
  process.exit(2);
}

if (import.meta.main) {
  let options: { version?: string; source?: string; repo?: string };
  try {
    options = parseArgs({
      options: {
        version: { type: 'string' },
        source: { type: 'string' },
        repo: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  const version = options.version ?? '';
  const source = options.source ?? '';
  const repo = options.repo ?? 'tale-project/tale';
  try {
    tagNames(version);
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  if (!COMMIT.test(source)) usage('--source takes a full commit SHA');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) usage('--repo takes owner/name');
  let decision: { proceed: boolean; reason: string };
  try {
    decision = sourceDecision({
      version,
      source,
      tags: await readTags(repo, version),
      releases: await readReleases(repo),
    });
  } catch (error) {
    // Unreadable tags or releases decide nothing: the step fails before
    // anything is written.
    annotate(
      `release-source: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  if (!decision.proceed) {
    annotate(decision.reason);
    process.exit(1);
  }
  console.log(`Publishes ${source} as ${version}: ${decision.reason}`);
}
