/**
 * Whether a Release run moves the `:latest` images and GitHub's Latest
 * release: only for the highest published version. A re-run or back-fill of
 * an older tag publishes that version and leaves both where they are
 * (v0.5.78–v0.5.80, re-run after v0.5.82, moved both back to v0.5.79).
 * Dependency-free: the release jobs run it from a sparse checkout.
 */
import { parseArgs } from 'node:util';

/** The fields of a GitHub release the decision reads. */
export type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
};

const VERSION = /^v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/;
const STABLE = /^v?(\d+\.\d+\.\d+)$/;

/** `gh api --jq` projection: one JSON line per release, the fields above. */
export const RELEASE_FIELDS =
  '.[] | [.tag_name, .draft, .prerelease, .published_at] | @json';

/** The version a release run publishes, without its `v`, or a thrown error. */
function releaseVersion(version: string): string {
  const number = VERSION.exec(version)?.[1];
  if (!number)
    throw new Error(`${version} is not an exact version such as v1.2.3`);
  return number;
}

/**
 * Moves only when the run is not sites-only, the version is stable, and no
 * published release is higher: drafts, pre-releases and other tags do not
 * count. An equal version moves, so a full re-run of the newest release keeps
 * `:latest` on the index it rebuilt.
 */
export function latestDecision({
  version,
  sitesOnly,
  releases,
}: {
  version: string;
  sitesOnly: boolean;
  releases: readonly Release[];
}): { move: boolean; reason: string } {
  const number = releaseVersion(version);
  if (sitesOnly) return { move: false, reason: 'a sites-only run keeps both' };
  if (!STABLE.test(number))
    return { move: false, reason: `${version} is a pre-release` };
  const higher = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        release.published_at !== null &&
        STABLE.test(release.tag_name),
    )
    .map((release) => release.tag_name)
    .filter((tag) => Bun.semver.order(releaseVersion(tag), number) > 0)
    .toSorted((a, b) => Bun.semver.order(releaseVersion(b), releaseVersion(a)));
  return higher.length === 0
    ? {
        move: true,
        reason: `${version} is at least as high as every published release`,
      }
    : { move: false, reason: `${higher[0]} is published and higher` };
}

/** One line of {@link RELEASE_FIELDS}, refused unless it has their shape. */
export function parseRelease(line: string): Release {
  const fields: unknown = JSON.parse(line);
  if (
    Array.isArray(fields) &&
    fields.length === 4 &&
    typeof fields[0] === 'string' &&
    typeof fields[1] === 'boolean' &&
    typeof fields[2] === 'boolean' &&
    (fields[3] === null || typeof fields[3] === 'string')
  ) {
    const [tag_name, draft, prerelease, published_at] = fields;
    return { tag_name, draft, prerelease, published_at };
  }
  throw new Error(`Unexpected release record: ${line}`);
}

/** Every release of the repository, read with `gh api` (GH_TOKEN). */
async function readReleases(repo: string): Promise<Release[]> {
  const child = Bun.spawn(
    [
      'gh',
      'api',
      '--paginate',
      `repos/${repo}/releases?per_page=100`,
      '--jq',
      RELEASE_FIELDS,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`gh api repos/${repo}/releases failed: ${stderr.trim()}`);
  return stdout.split('\n').filter(Boolean).map(parseRelease);
}

function usage(message: string): never {
  console.error(`release-latest: ${message}`);
  console.error(
    'usage: bun tools/cli/scripts/release-latest.ts --version vX.Y.Z [--sites-only true|false] [--repo owner/name]',
  );
  process.exit(2);
}

if (import.meta.main) {
  let options: { version?: string; 'sites-only'?: string; repo?: string };
  try {
    options = parseArgs({
      options: {
        version: { type: 'string' },
        'sites-only': { type: 'string' },
        repo: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  const version = options.version ?? '';
  const sitesOnly = options['sites-only'] ?? 'false';
  const repo = options.repo ?? 'tale-project/tale';
  try {
    releaseVersion(version);
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  if (sitesOnly !== 'true' && sitesOnly !== 'false')
    usage('--sites-only takes true or false');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) usage('--repo takes owner/name');
  try {
    const decision = latestDecision({
      version,
      sitesOnly: sitesOnly === 'true',
      releases: sitesOnly === 'true' ? [] : await readReleases(repo),
    });
    console.error(
      `${decision.move ? 'Moves' : 'Keeps'} :latest and GitHub Latest: ${decision.reason}`,
    );
    console.log(String(decision.move));
  } catch (error) {
    // Unreadable history decides nothing: the step fails before a tag moves.
    console.error(
      `release-latest: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
