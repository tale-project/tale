/**
 * The stateless line emitters — the shared output vocabulary every `tale` command
 * and `bun run dev` render through. Each reads the configured palette/markers
 * from the context at use-time and routes through {@link writeLine}.
 *
 * Verbosity: `--quiet` suppresses decorative lines (info/done/rule/debug and a
 * non-error surfaced line) but NEVER a warning or error; `--verbose` is the only
 * level that shows `debugLine`. `--json` (silent) suppresses all stdout chrome.
 */

import { padCell, type Palette } from '../terminal/index';
import {
  getCapabilities,
  getMarkers,
  getPalette,
  getReporterLevel,
  writeLine,
} from './context';
import { type MarkerKind, styledMarker } from './markers';

/** The level a surfaced subprocess line carries. (Distinct from the classifier's
 *  5-value `LineKind` — these are only the kinds the reporter renders.) */
export type SourceKind = 'info' | 'warn' | 'error';

function quiet(): boolean {
  return getReporterLevel() === 'quiet';
}

function marker(kind: MarkerKind): string {
  return styledMarker(kind, getPalette(), getMarkers());
}

/** A success line — also a `runStep`'s success terminal. Suppressed by `--quiet`. */
export function doneLine(message: string): void {
  if (quiet()) return;
  writeLine(`${marker('done')} ${message}`);
}

/** Neutral information, rendered gray. Suppressed by `--quiet`. */
export function infoLine(message: string): void {
  if (quiet()) return;
  const p = getPalette();
  writeLine(`${p.dim}${getMarkers().info} ${message}${p.reset}`);
}

/** A non-fatal warning — always shown (even under `--quiet`). */
export function warnLine(message: string): void {
  const p = getPalette();
  writeLine(`${p.yellow}${getMarkers().warn} ${message}${p.reset}`);
}

/** A failure (to stderr) — always shown. */
export function errorLine(message: string): void {
  const p = getPalette();
  writeLine(`${p.red}${getMarkers().error} ${message}${p.reset}`, true);
}

/** A question put to the user (interactive prompts). */
export function questionLine(message: string): void {
  writeLine(`${marker('question')} ${message}`);
}

/** Verbose-only diagnostic line; shown only under `--verbose`. */
export function debugLine(message: string): void {
  if (getReporterLevel() !== 'verbose') return;
  const p = getPalette();
  writeLine(`${p.dim}${getMarkers().info} ${message}${p.reset}`);
}

/** A surfaced subprocess line, tagged with its source: `[ ! ] docker  some warning`.
 *  A non-error line is suppressed by `--quiet`; an error always shows (stderr). */
export function sourceLine(
  source: string,
  kind: SourceKind,
  text: string,
): void {
  if (kind !== 'error' && quiet()) return;
  const p = getPalette();
  writeLine(
    `${marker(kind)} ${p.dim}${source}${p.reset}  ${text}`,
    kind === 'error',
  );
}

/** Dim, indented context lines — e.g. a failure tail under an `[ x ]` line. */
export function detailLines(lines: readonly string[]): void {
  const p = getPalette();
  for (const line of lines) writeLine(`${p.dim}    ${line}${p.reset}`);
}

/** An ASCII separator line — used instead of blank lines to break up sections. */
export function rule(): void {
  if (quiet()) return;
  const p = getPalette();
  const columns = getCapabilities().columns || 60;
  writeLine(`${p.dim}${'-'.repeat(Math.min(columns, 60))}${p.reset}`);
}

/** A two-column key/value table, width-aware so non-Latin keys still align. */
export function table(rows: readonly [string, string][]): void {
  if (rows.length === 0) return;
  const p = getPalette();
  const keyWidth = Math.max(...rows.map(([key]) => key.length));
  for (const [key, value] of rows) {
    writeLine(`  ${padCell(key, keyWidth)}  ${p.dim}${value}${p.reset}`);
  }
}

/**
 * A small, tasteful wordmark for bare `tale` and `--help`. ASCII-only so it
 * renders identically everywhere. Returns the string (the caller decides where
 * it goes — Commander prints help to stdout).
 */
export function bannerText(
  version: string,
  palette: Palette = getPalette(),
): string {
  return `  ${palette.bold}${palette.cyan}Tale${palette.reset} ${palette.dim}v${version}${palette.reset}  ${palette.dim}- your self-hosted AI workforce${palette.reset}`;
}
