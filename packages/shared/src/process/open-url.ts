/**
 * Open a URL in the user's default browser.
 *
 * Best-effort and non-throwing: tries each platform opener in turn and returns
 * whether one succeeded, so the caller decides how to surface a miss (e.g. print
 * the URL to visit). It deliberately does NO logging of its own — each caller
 * routes diagnostics through its own sink (the CLI's `logger`/`warnLine`, the
 * dev orchestrator's reporter), passed in as `onDebug`.
 *
 * CLI/script-only — uses `Bun.spawn`, so (like the rest of this subpath) it must
 * never be reachable from `@tale/shared/logging/logger` (the Convex V8 boundary).
 */
export interface OpenUrlOptions {
  /** Per-attempt diagnostic sink. Called when an opener errors (e.g. ENOENT). */
  onDebug?: (message: string) => void;
}

export async function openUrl(
  url: string,
  options: OpenUrlOptions = {},
): Promise<boolean> {
  const commands: readonly string[][] =
    process.platform === 'darwin'
      ? [['open', url]]
      : process.platform === 'win32'
        ? // The empty title arg is required: `start "url"` treats a single quoted
          // token as the window title, not the target.
          [['cmd', '/c', 'start', '', url]]
        : [
            ['xdg-open', url],
            ['sensible-browser', url],
            ['x-www-browser', url],
          ];

  for (const [cmd, ...args] of commands) {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) return true;
    } catch (err) {
      // A missing opener (ENOENT) is expected as we fall through each candidate;
      // surface it only at the caller's debug level.
      options.onDebug?.(
        `Browser opener ${cmd} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return false;
}
