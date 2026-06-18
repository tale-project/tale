/**
 * `@tale/shared/tux` — the cross-terminal CLI output (TUX) layer shared by `bun
 * run dev` and every `tale` command, so they all look and behave identically.
 *
 * Design (NOT per-line "is this a warning?" guessing, which leaked benign noise):
 *
 *  - A long phase is a `runStep`: one live-updating bracketed line that ends in
 *    exactly one of three terminals — `[ + ]` done, `[ ! ]` warn (degraded but
 *    continued), or `[ x ]` error. Throw a {@link StepWarning} to end as `warn`
 *    without propagating; any other throw ends as `error` and rethrows.
 *  - While a step runs it is the SINGLE writer (a `LiveRegion`). Output captured
 *    during the step is held by the owner and dumped only on failure — success is
 *    clean by construction, so nothing benign leaks.
 *  - The long-running servers stream meaningful lines via `sourceLine`
 *    (warn/error only — their "ready" milestones duplicate the step + READY view).
 *
 * One configured source of truth: `configureReporter()` / `setReporterSilent()`
 * (`--json`) / `setReporterLevel()` (`--quiet`/`--verbose`) drive every emitter.
 * Markers are capability-aware (`[ ✓ ]` vs `[ + ]`, never emoji); the cursor is
 * always restored on exit/crash.
 *
 * CLI/script-only (drives a real stream); never imported by the Convex bundler.
 */

export type { Capabilities, Markers, Palette } from '../terminal/index';

export {
  configureReporter,
  getCapabilities,
  getMarkers,
  getPalette,
  getReporterLevel,
  type ReporterLevel,
  setReporterLevel,
  setReporterSilent,
} from './context';

export {
  bannerText,
  debugLine,
  detailLines,
  doneLine,
  errorLine,
  infoLine,
  questionLine,
  rule,
  type SourceKind,
  sourceLine,
  table,
  warnLine,
} from './lines';

export { runStep, type StepLabel, StepWarning } from './step';
