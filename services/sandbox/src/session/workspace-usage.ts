// How much session workspaces hold: the largest ones, for the operator of a
// session disk that is about to run out (which sessions are filling it is the
// first thing to know, and nothing else on the host says it), and each of an
// organization's, for the platform's reclaim of the largest idle ones.
//
// One `du` measures the workspace dirs under the session root, at the lowest
// CPU priority, and only for so long: a disk this full is usually a busy one,
// and a workspace can hold millions of files. Its I/O priority is the
// ordinary one under the mq-deadline and none schedulers most NVMe disks use
// (only CFQ and BFQ derive it from the nice value), which the deadline
// bounds. Whatever it measured by the deadline is reported, marked as
// incomplete.

import { listWorkspacePaths } from './workspace-inventory.ts';

export interface WorkspaceUsage {
  sessionId: string;
  bytes: number;
}

export interface LargestWorkspaces {
  /** Largest first, at most the limit asked for. */
  largest: WorkspaceUsage[];
  /** Workspace dirs measured, of `total` found. */
  measured: number;
  total: number;
}

export interface WorkspaceUsageDeps {
  /** Run `du` over the paths and resolve with what it printed until it
   * ended or the signal stopped it. */
  du?: (paths: string[], signal: AbortSignal) => Promise<string>;
  listPaths?: typeof listWorkspacePaths;
}

/** How long one measurement may take. */
const WORKSPACE_USAGE_TIMEOUT_MS = 30_000;

async function runDu(paths: string[], signal: AbortSignal): Promise<string> {
  // `-x`: a workspace never spans filesystems, and a mount inside one is not
  // what fills the session disk.
  const proc = Bun.spawn(
    ['nice', '-n', '19', 'du', '-s', '-k', '-x', '--', ...paths],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const stop = () => proc.kill();
  signal.addEventListener('abort', stop, { once: true });
  try {
    return await new Response(proc.stdout).text();
  } finally {
    signal.removeEventListener('abort', stop);
    await proc.exited;
  }
}

/** One bounded `du` over these workspace dirs: the bytes of each session
 * it reported on by the deadline (a session with copies in both layouts
 * holds them all), how many of each session's dirs that covered, and how
 * many dirs it measured in all. */
async function measureDirs(
  dirs: ReadonlyArray<{ sessionId: string; path: string }>,
  timeoutMs: number,
  du: NonNullable<WorkspaceUsageDeps['du']>,
): Promise<{
  bytes: Map<string, { bytes: number; dirs: number }>;
  measured: number;
}> {
  const sessionOf = new Map(dirs.map((dir) => [dir.path, dir.sessionId]));
  const output = await du(
    dirs.map((dir) => dir.path),
    AbortSignal.timeout(timeoutMs),
  );
  const bytes = new Map<string, { bytes: number; dirs: number }>();
  let measured = 0;
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const kib = Number(line.slice(0, tab));
    const sessionId = sessionOf.get(line.slice(tab + 1));
    if (!Number.isSafeInteger(kib) || sessionId === undefined) continue;
    measured += 1;
    const known = bytes.get(sessionId) ?? { bytes: 0, dirs: 0 };
    bytes.set(sessionId, {
      bytes: known.bytes + kib * 1024,
      dirs: known.dirs + 1,
    });
  }
  return { bytes, measured };
}

/** The `limit` largest workspaces under `root`, as far as one `du` measured
 * them within `timeoutMs`. THROWS when the root cannot be read. */
export async function largestWorkspaces(
  root: string,
  { limit = 3, timeoutMs = WORKSPACE_USAGE_TIMEOUT_MS } = {},
  deps: WorkspaceUsageDeps = {},
): Promise<LargestWorkspaces> {
  const dirs = await (deps.listPaths ?? listWorkspacePaths)(root);
  if (dirs.length === 0) return { largest: [], measured: 0, total: 0 };
  const { bytes, measured } = await measureDirs(
    dirs,
    timeoutMs,
    deps.du ?? runDu,
  );
  const largest = [...bytes]
    .map(([sessionId, size]) => ({ sessionId, bytes: size.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
  return { largest, measured, total: dirs.length };
}

/** The bytes each named session's workspace holds under `root`, measured
 * now by one `du` within `timeoutMs`: null for a session whose every dir it
 * did not reach by the deadline (or that has none). THROWS when the root
 * cannot be read, or `du` cannot run. */
export async function measureWorkspaces(
  root: string,
  sessionIds: readonly string[],
  { timeoutMs = WORKSPACE_USAGE_TIMEOUT_MS } = {},
  deps: WorkspaceUsageDeps = {},
): Promise<Map<string, number | null>> {
  const sizes = new Map<string, number | null>(
    sessionIds.map((sessionId) => [sessionId, null]),
  );
  const dirs = (await (deps.listPaths ?? listWorkspacePaths)(root)).filter(
    (dir) => sizes.has(dir.sessionId),
  );
  if (dirs.length === 0) return sizes;
  const expected = new Map<string, number>();
  for (const dir of dirs) {
    expected.set(dir.sessionId, (expected.get(dir.sessionId) ?? 0) + 1);
  }
  const { bytes } = await measureDirs(dirs, timeoutMs, deps.du ?? runDu);
  for (const [sessionId, size] of bytes) {
    // Half of a session's copies is not its size.
    if (size.dirs === expected.get(sessionId)) sizes.set(sessionId, size.bytes);
  }
  return sizes;
}

/** How long a workspace's measured size stands for the reclaim's reads. */
export const WORKSPACE_SIZE_TTL_MS = 10 * 60_000;
/** The most workspaces one read measures. */
const WORKSPACE_SIZES_PER_READ = 50;
/** A size nobody asked about for this long is forgotten. */
const WORKSPACE_SIZE_FORGET_MS = 24 * 60 * 60_000;

/** One workspace in GET /v1/workspaces/usage: its size, null when it was
 * not measured or its measurement failed or ran out of time, and when that
 * was, null when never. */
export interface WorkspaceSize {
  sessionId: string;
  bytes: number | null;
  measuredAtMs: number | null;
}

/** The workspaces' sizes as last measured. A read measures the ones it
 * names that are unmeasured or older than {@link WORKSPACE_SIZE_TTL_MS},
 * the longest unmeasured first and at most {@link WORKSPACE_SIZES_PER_READ}
 * of them, and answers the rest as last measured. One measurement runs at a
 * time: a read that arrives meanwhile waits for it. A measurement that
 * failed is kept like any other, so a workspace too large to measure in time
 * is tried again after the TTL rather than on every read. */
export class WorkspaceUsageCache {
  private readonly sizes = new Map<
    string,
    { bytes: number | null; atMs: number }
  >();
  private measuring: Promise<void> | null = null;

  constructor(
    private readonly measure: (
      sessionIds: readonly string[],
    ) => Promise<ReadonlyMap<string, number | null>>,
    private readonly now: () => number = Date.now,
  ) {}

  async usage(sessionIds: readonly string[]): Promise<WorkspaceSize[]> {
    const named = [...new Set(sessionIds)];
    while (this.measuring !== null) await this.measuring;
    const now = this.now();
    for (const [sessionId, known] of this.sizes) {
      if (now - known.atMs >= WORKSPACE_SIZE_FORGET_MS)
        this.sizes.delete(sessionId);
    }
    const measuredAt = (sessionId: string) =>
      this.sizes.get(sessionId)?.atMs ?? -1;
    const due = named
      .filter((sessionId) => {
        const known = this.sizes.get(sessionId);
        return known === undefined || now - known.atMs >= WORKSPACE_SIZE_TTL_MS;
      })
      .sort((a, b) => measuredAt(a) - measuredAt(b))
      .slice(0, WORKSPACE_SIZES_PER_READ);
    if (due.length > 0) {
      const measuring = this.measureNow(due).finally(() => {
        this.measuring = null;
      });
      this.measuring = measuring;
      await measuring;
    }
    return named.map((sessionId) => {
      const known = this.sizes.get(sessionId);
      return {
        sessionId,
        bytes: known?.bytes ?? null,
        measuredAtMs: known?.atMs ?? null,
      };
    });
  }

  private async measureNow(sessionIds: readonly string[]): Promise<void> {
    let sizes: ReadonlyMap<string, number | null> = new Map();
    try {
      sizes = await this.measure(sessionIds);
    } catch (error) {
      console.warn(
        '[sandbox.session] measuring workspace sizes failed; they read as unknown:',
        error,
      );
    }
    const atMs = this.now();
    for (const sessionId of sessionIds) {
      this.sizes.set(sessionId, { bytes: sizes.get(sessionId) ?? null, atMs });
    }
  }
}
