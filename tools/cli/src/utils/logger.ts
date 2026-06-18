/**
 * CLI terminal output — a thin adapter over the shared `@tale/shared/tux`, so
 * every `tale` command renders with the SAME bracketed-ASCII markers + live steps
 * as `bun run dev`:
 *
 *   success → [ + ]   info/step/header/notice → [ - ]   warn → [ ! ]   error → [ x ]
 *
 * It owns NO palette of its own — color/markers come from the one configured
 * `tux` source (so `--no-color` etc. flow through). `runStep` (live spinners) is
 * imported from `@tale/shared/tux` directly by commands that have real waits.
 * `blank()` is a no-op kept for back-compat (the reporter uses ASCII rules).
 */

import {
  bannerText as tuxBanner,
  debugLine,
  doneLine,
  errorLine,
  infoLine,
  sourceLine,
  table as tuxTable,
  warnLine,
} from '@tale/shared/tux';

export function info(message: string) {
  infoLine(message);
}

export function warn(message: string) {
  warnLine(message);
}

export function error(message: string) {
  errorLine(message);
}

export function debug(message: string) {
  debugLine(message);
}

export function success(message: string) {
  doneLine(message);
}

export function step(message: string) {
  infoLine(message);
}

export function notice(message: string) {
  infoLine(message);
}

export function containerLog(service: string, line: string) {
  const truncated = line.length > 200 ? `${line.slice(0, 200)}...` : line;
  sourceLine(service, 'info', truncated);
}

/** No-op: the reporter uses ASCII rules instead of blank lines. Kept for callers. */
export function blank() {
  // Intentionally empty — blank lines are no longer used.
}

/** An intent line opening a command's output (e.g. `[ - ] Deploying Tale 1.2.3`). */
export function header(title: string) {
  infoLine(title);
}

/** A two-column key/value table — delegates to the shared, width-aware renderer. */
export function table(rows: [string, string][]) {
  tuxTable(rows);
}

/** The small wordmark shown for bare `tale` and `--help`. */
export function bannerText(version: string): string {
  return tuxBanner(version);
}
