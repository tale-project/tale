// How much the largest session workspaces hold, for the operator of a session
// disk that is about to run out: which sessions are filling it is the first
// thing to know, and nothing else on the host says it.
//
// One `du` measures every workspace dir under the session root, at the
// lowest CPU priority — which also gives it the lowest best-effort I/O
// priority, the kernel's default for a niced process — and only for so long:
// a disk this full is usually a busy one, and a workspace can hold millions
// of files. Whatever it measured by the deadline is reported, marked as
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

/** The `limit` largest workspaces under `root`, as far as one `du` measured
 * them within `timeoutMs`. THROWS when the root cannot be read. */
export async function largestWorkspaces(
  root: string,
  { limit = 3, timeoutMs = WORKSPACE_USAGE_TIMEOUT_MS } = {},
  deps: WorkspaceUsageDeps = {},
): Promise<LargestWorkspaces> {
  const dirs = await (deps.listPaths ?? listWorkspacePaths)(root);
  if (dirs.length === 0) return { largest: [], measured: 0, total: 0 };
  const sessionOf = new Map(dirs.map((dir) => [dir.path, dir.sessionId]));
  const output = await (deps.du ?? runDu)(
    dirs.map((dir) => dir.path),
    AbortSignal.timeout(timeoutMs),
  );
  const bytes = new Map<string, number>();
  let measured = 0;
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const kib = Number(line.slice(0, tab));
    const sessionId = sessionOf.get(line.slice(tab + 1));
    if (!Number.isSafeInteger(kib) || sessionId === undefined) continue;
    measured += 1;
    // A session with copies in both layouts holds them all.
    bytes.set(sessionId, (bytes.get(sessionId) ?? 0) + kib * 1024);
  }
  const largest = [...bytes]
    .map(([sessionId, size]) => ({ sessionId, bytes: size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
  return { largest, measured, total: dirs.length };
}
