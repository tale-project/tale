/**
 * Thread-level sandbox working directory (`threadMetadata.sandboxWorkdir`).
 *
 * The stored value is a path RELATIVE to the session workspace root
 * (`/agent/workspace`); unset/empty means the root itself. Validation is strict
 * because the platform is the only workspace-confinement guard: the
 * in-container runnerd merely requires a cwd to realpath under `/agent`, so a
 * `..` segment would legally escape the workspace (e.g. into `/agent/.runtime`).
 * Resolution to an absolute path happens platform-side too — runnerd resolves
 * RELATIVE paths against `/agent`, not `/agent/workspace`, so a raw relative
 * value must never reach the exec API.
 */

export const SANDBOX_WORKSPACE_ABS_ROOT = '/agent/workspace';

const SANDBOX_WORKDIR_MAX_LENGTH = 256;

/** One path segment: no separators, no whitespace, no control chars. */
const WORKDIR_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export type SandboxWorkdirError = 'absolute' | 'too-long' | 'bad-segment';

/**
 * Clean the common paste/typing artifacts before validating: surrounding
 * whitespace, a leading `./`, trailing slashes, and the bare `.` alias for
 * the root. Never *repairs* an invalid path — `a/../b` stays invalid.
 */
export function normalizeSandboxWorkdir(input: string): string {
  let rel = input.trim();
  while (rel.startsWith('./')) rel = rel.slice(2);
  while (rel.endsWith('/') && rel.length > 1) rel = rel.slice(0, -1);
  if (rel === '.' || rel === '/') return '';
  return rel;
}

/**
 * Validate a NORMALIZED workspace-relative workdir. `''` (the root) is valid.
 * Returns the failure reason so the UI can message it, `null` when valid.
 * `.` / `..` segments are rejected explicitly — both match the segment
 * charset, and `..` is exactly the workspace escape this guard exists for.
 */
export function sandboxWorkdirError(rel: string): SandboxWorkdirError | null {
  if (rel === '') return null;
  if (rel.startsWith('/')) return 'absolute';
  if (rel.length > SANDBOX_WORKDIR_MAX_LENGTH) return 'too-long';
  for (const segment of rel.split('/')) {
    if (segment === '.' || segment === '..') return 'bad-segment';
    if (!WORKDIR_SEGMENT_RE.test(segment)) return 'bad-segment';
  }
  return null;
}

export function isValidSandboxWorkdir(rel: string): boolean {
  return sandboxWorkdirError(rel) === null;
}

/** Absolute cwd for the agent process; unset/empty → the workspace root. */
export function resolveSandboxWorkdirAbs(
  rel: string | null | undefined,
): string {
  if (rel == null || rel === '') return SANDBOX_WORKSPACE_ABS_ROOT;
  return `${SANDBOX_WORKSPACE_ABS_ROOT}/${rel}`;
}

/**
 * Session-relative path of the workdir for spawner file APIs
 * (`sessionListFiles` and friends address the workspace as `workspace/…`).
 */
export function sandboxWorkdirSessionPath(
  rel: string | null | undefined,
): string {
  if (rel == null || rel === '') return 'workspace';
  return `workspace/${rel}`;
}
