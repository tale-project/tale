/**
 * The mutable reporter context: the single configured source of terminal
 * capabilities/palette/markers, the active live region, and the output-mode
 * switches (`silent` for `--json`, `level` for `--quiet`/`--verbose`). Everything
 * in `tux/` reads this context at use-time, so one `configureReporter()` call (in
 * the CLI's `preAction` hook) is reflected everywhere — no per-call-site palette.
 *
 * CLI/script-only (drives a real stream + holds a `LiveRegion`).
 */

import {
  type Capabilities,
  detectCapabilities,
  makeMarkers,
  makePalette,
  type Markers,
  type Palette,
} from '../terminal/index';
import type { LiveRegion } from '../terminal/live';

/** Verbosity band: `quiet` shows only warn/error; `verbose` also shows debug. */
export type ReporterLevel = 'quiet' | 'normal' | 'verbose';

let caps: Capabilities = detectCapabilities();
let palette: Palette = makePalette(caps.color);
let markers: Markers = makeMarkers(caps.unicode);
let activeRegion: LiveRegion | null = null;
let silenced = false;
let level: ReporterLevel = 'normal';
let teardownRegistered = false;

/** Override the auto-detected capabilities (e.g. honoring a CLI `--no-color`). */
export function configureReporter(next: Capabilities): void {
  caps = next;
  palette = makePalette(next.color);
  markers = makeMarkers(next.unicode);
}

export function getCapabilities(): Capabilities {
  return caps;
}
export function getPalette(): Palette {
  return palette;
}
export function getMarkers(): Markers {
  return markers;
}

/** `--json`: suppress decorative stdout, but never errors (they stay on stderr). */
export function setReporterSilent(on: boolean): void {
  silenced = on;
}
export function setReporterLevel(next: ReporterLevel): void {
  level = next;
}
export function getReporterLevel(): ReporterLevel {
  return level;
}

export function setActiveRegion(region: LiveRegion | null): void {
  activeRegion = region;
}

function disposeActiveRegion(): void {
  if (activeRegion) {
    activeRegion.dispose();
    activeRegion = null;
  }
}

/**
 * Register crash/exit teardown ONCE, lazily — called when the first live region
 * mounts. Restores the cursor on exit / SIGINT / SIGTERM / uncaughtException so a
 * crash mid-region never leaves an invisible cursor. Lazy (not import-time) so
 * merely importing `tux` has no side effect.
 */
export function ensureTeardownRegistered(): void {
  if (teardownRegistered || typeof process === 'undefined') return;
  teardownRegistered = true;
  for (const signal of ['exit', 'SIGINT', 'SIGTERM'] as const) {
    process.once(signal, disposeActiveRegion);
  }
  // Use the *monitor* variant for crashes: restore the cursor without
  // suppressing Node's default termination (a plain `uncaughtException`
  // listener would swallow the crash and leave the process running degraded).
  process.on('uncaughtExceptionMonitor', disposeActiveRegion);
}

/**
 * The single low-level writer. Routes a finished line through the active region
 * (so it graduates above a running spinner) or straight to the stream. Silent
 * mode suppresses stdout chrome but never an error (stderr).
 */
export function writeLine(text: string, toErr = false): void {
  if (silenced && !toErr) return;
  if (activeRegion) {
    activeRegion.print(text);
    return;
  }
  if (typeof process === 'undefined') return;
  if (toErr) process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
}
