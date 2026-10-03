import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

const count = z.number().int().nonnegative();
const daily = z.object({ timestamp: z.iso.datetime(), count, uniques: count });
const totals = z.object({ count, uniques: count });
const endpoints = [
  'views',
  'clones',
  'popular/referrers',
  'popular/paths',
] as const;
const schemas = {
  views: totals.extend({ views: z.array(daily) }),
  clones: totals.extend({ clones: z.array(daily) }),
  'popular/referrers': z.array(
    z.object({ referrer: z.string(), count, uniques: count }),
  ),
  'popular/paths': z.array(
    z.object({ path: z.string(), title: z.string(), count, uniques: count }),
  ),
};

export type TrafficEndpoint = keyof typeof schemas;

function readTraffic(endpoint: TrafficEndpoint): unknown {
  try {
    return JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          '--hostname',
          'github.com',
          `repos/tale-project/tale/traffic/${endpoint}`,
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    );
  } catch {
    throw new Error(
      `Could not read GitHub traffic (${endpoint}); check gh authentication and repository administration access.`,
    );
  }
}

/** Keep owner-only traffic outside a checkout, including a symlink into one. */
async function privateDirectory(directory: string): Promise<string> {
  if (!isAbsolute(directory))
    throw new Error('Use an absolute output directory outside a Git checkout.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolved = await realpath(directory);
  const checkout = spawnSync(
    'git',
    ['-C', resolved, 'rev-parse', '--show-toplevel'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        LC_ALL: 'C',
        GIT_CEILING_DIRECTORIES: '',
        GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
      },
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (checkout.status === 0) {
    throw new Error(
      'Traffic snapshots must be stored outside Git; they are private owner analytics.',
    );
  }
  if (
    checkout.error ||
    checkout.status !== 128 ||
    checkout.stderr?.trim() !==
      'fatal: not a git repository (or any of the parent directories): .git'
  ) {
    throw new Error(
      'Cannot verify the private output directory; check that Git is installed and can inspect it.',
    );
  }
  return resolved;
}

export async function snapshotTraffic(
  outputDirectory: string,
  read: (endpoint: TrafficEndpoint) => unknown = readTraffic,
  now: Date = new Date(),
): Promise<string> {
  const collectedAt = now.toISOString();
  const directory = await privateDirectory(outputDirectory);
  const traffic = Object.fromEntries(
    endpoints.map((endpoint) => [
      endpoint,
      schemas[endpoint].parse(read(endpoint)),
    ]),
  );
  const snapshot = {
    repository: 'tale-project/tale',
    collectedAt,
    window: 'GitHub rolling 14 days; overlapping snapshots must not be summed.',
    interpretation:
      'Counts can include automation. Clones are not installs or active users. Referrers are the top 10, not complete attribution.',
    traffic,
  };
  const filename = join(directory, `${collectedAt.replaceAll(':', '-')}.json`);
  await writeFile(filename, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return filename;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { 'output-dir': { type: 'string' } },
  });
  const directory =
    values['output-dir'] ?? join(homedir(), '.local/share/tale/discovery');
  try {
    console.log(await snapshotTraffic(directory));
  } catch (error) {
    console.error(
      error instanceof z.ZodError
        ? 'GitHub returned an unexpected traffic response; no snapshot was saved.'
        : error instanceof Error
          ? error.message
          : 'Traffic snapshot failed.',
    );
    process.exitCode = 1;
  }
}
