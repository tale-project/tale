/**
 * The thread workspace is one virtual filesystem rooted at `/user`, mounted
 * 1:1 by the sandbox. There is ONE canonical path per file — the absolute
 * `/user/<root>/<rel>` path — stored verbatim as `threadFiles.path` and used
 * by every file tool, by `run_code` scripts, and by staging/harvest. No
 * per-tool conversion: the model sees the same path everywhere.
 *
 * The three roots carry provenance (also denormalized onto `threadFiles.source`
 * for the Canvas + queries):
 *   /user/uploads → user_upload   (user-supplied inputs)
 *   /user/code    → agent_write   (files the model authors; executable)
 *   /user/output  → run_output    (files run_code produces)
 *
 * Resolving a path to a threadFile is pure — no running container needed — so a
 * thread that never starts a sandbox still uses the same scheme.
 */

import { InvalidFilePathError, validatePath } from './_shared';

export type WorkspaceSource = 'user_upload' | 'agent_write' | 'run_output';

export const SANDBOX_ROOT_BY_SOURCE: Record<WorkspaceSource, string> = {
  user_upload: '/user/uploads',
  agent_write: '/user/code',
  run_output: '/user/output',
};

const SOURCE_BY_ROOT: Record<string, WorkspaceSource> = {
  uploads: 'user_upload',
  code: 'agent_write',
  output: 'run_output',
};

const ROOT_RE = /^\/user\/(uploads|code|output)\/(.+)$/;

export interface ParsedWorkspacePath {
  /** Canonical absolute path, e.g. `/user/code/gen.py`. */
  path: string;
  source: WorkspaceSource;
  /** Path relative to the sandbox root, e.g. `gen.py` — for spawner staging. */
  rel: string;
}

/**
 * Parse + validate a model-supplied workspace path. Returns `null` when it is
 * not an absolute `/user/{uploads,code,output}/…` path (a mistake worth
 * surfacing). Throws {@link InvalidFilePathError} for a valid root with a bad
 * relative segment (`..`, illegal chars).
 */
export function parseWorkspacePath(input: string): ParsedWorkspacePath | null {
  const m = ROOT_RE.exec(input.trim());
  if (m === null) return null;
  const rel = validatePath(m[2]); // reject `..` / empty / illegal chars
  return {
    path: `/user/${m[1]}/${rel}`,
    source: SOURCE_BY_ROOT[m[1]],
    rel,
  };
}

/** Build the canonical absolute path from a `source` + sandbox-relative name
 *  (harvest side: `('run_output', 'report.pptx')` → `/user/output/report.pptx`). */
export function workspacePathOf(source: WorkspaceSource, rel: string): string {
  return `${SANDBOX_ROOT_BY_SOURCE[source]}/${rel}`;
}

/** Strip a stored absolute path to its sandbox-relative form for the spawner
 *  staging payloads (`/user/code/gen.py` → `gen.py`). */
export function relOf(absolutePath: string): string {
  const m = ROOT_RE.exec(absolutePath);
  return m === null ? absolutePath : m[2];
}

export { InvalidFilePathError };
