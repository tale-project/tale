/**
 * One terminal-capability probe, shared by the CLI and the dev orchestrator.
 *
 * Replaces the two independent `isTTY && !NO_COLOR` derivations that had grown up
 * (the shared logger and the CLI's `terminal.ts`). It separates three orthogonal
 * questions the old code conflated:
 *
 *   - `color`       — may we emit SGR color escapes?
 *   - `interactive` — may we repaint a live region (cursor-up/clear-line)?
 *   - `unicode`     — may we use non-ASCII glyphs, or must we fall back to ASCII?
 *
 * The function is PURE given an injected {@link CapabilityEnv} (defaulting to a
 * defensive read of the real `process`), so the whole decision matrix is
 * table-testable without a real TTY — the `pull-image.ts` / `progress.test.ts`
 * dependency-injection pattern.
 *
 * node-free: this module reads `process.*` defensively but never value-imports a
 * `node:*` module, so it stays reachable from the Convex V8 bundler without
 * tripping the `Could not resolve "node:*"` boundary.
 */

export interface Capabilities {
  /** SGR color escapes are allowed. */
  color: boolean;
  /** A live region (cursor-up + clear-line repaint) is allowed. */
  interactive: boolean;
  /** Non-ASCII glyphs (braille spinner, ✓/✗) are allowed; else ASCII fallbacks. */
  unicode: boolean;
  /** Terminal width in columns; 80 when unknown. */
  columns: number;
  isTTY: boolean;
  isCI: boolean;
}

/** Inputs to {@link detectCapabilities}; every field defaults to a real `process` read. */
export interface CapabilityEnv {
  isTTY?: boolean;
  columns?: number;
  platform?: string;
  env?: Record<string, string | undefined>;
}

function readProcessEnv(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !/^(0|false|no|off|)$/i.test(value.trim());
}

/** `NO_COLOR` honors presence, not value (no-color.org) — even an empty string disables. */
function noColorSet(env: Record<string, string | undefined>): boolean {
  return env.NO_COLOR !== undefined;
}

/** `FORCE_COLOR` forces color on unless explicitly `0`/`false` (the chalk convention). */
function forceColorSet(env: Record<string, string | undefined>): boolean {
  const value = env.FORCE_COLOR;
  if (value === undefined) return false;
  return !/^(0|false)$/i.test(value.trim());
}

function isCiEnv(env: Record<string, string | undefined>): boolean {
  return (
    truthy(env.CI) ||
    env.GITHUB_ACTIONS !== undefined ||
    env.GITLAB_CI !== undefined ||
    env.BUILDKITE !== undefined
  );
}

/** Windows Terminal / VS Code / ConEmu / ANSICON all guarantee VT processing. */
function hasModernWindowsTerminal(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(
    env.WT_SESSION ||
    env.TERM_PROGRAM ||
    env.ANSICON ||
    env.ConEmuANSI === 'ON',
  );
}

function localeIsUtf8(env: Record<string, string | undefined>): boolean {
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
  // No locale set at all → assume a modern UTF-8 terminal (true on macOS/Linux
  // defaults). Only downgrade to ASCII when a locale is explicitly non-UTF-8.
  if (!locale) return true;
  return /utf-?8/i.test(locale);
}

/**
 * Compute the terminal capability profile. `interactive` and `color` are
 * deliberately independent: `NO_COLOR` in a real TTY strips color but KEEPS the
 * live region; `FORCE_COLOR` in CI enables color but NEVER the live region
 * (cursor escapes would be recorded as literal `^[[2A` garbage in a CI log).
 */
export function detectCapabilities(input: CapabilityEnv = {}): Capabilities {
  const env = input.env ?? readProcessEnv();
  const platform =
    input.platform ??
    (typeof process !== 'undefined' ? process.platform : 'linux');
  const isTTY =
    input.isTTY ??
    (typeof process !== 'undefined' ? (process.stdout?.isTTY ?? false) : false);
  const columns =
    input.columns ??
    (typeof process !== 'undefined' ? (process.stdout?.columns ?? 80) : 80);

  const isCI = isCiEnv(env);
  const isDumb = env.TERM === 'dumb';
  const isWindowsLegacy =
    platform === 'win32' && !hasModernWindowsTerminal(env);

  // VT (ANSI) processing is not guaranteed on a true dumb terminal or a legacy
  // Windows console — there, literal escape bytes are worse than no liveness, so
  // both color and the live region are off (FORCE_COLOR can still override color).
  const vtUnsafe = isDumb || isWindowsLegacy;

  const color = noColorSet(env)
    ? false
    : forceColorSet(env)
      ? true
      : isTTY && !vtUnsafe;

  const interactive =
    isTTY && !isCI && !isDumb && !isWindowsLegacy && !truthy(env.TALE_VERBOSE);

  const unicode =
    interactive && !isDumb && !isWindowsLegacy && localeIsUtf8(env);

  return { color, interactive, unicode, columns, isTTY, isCI };
}
