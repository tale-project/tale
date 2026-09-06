/**
 * Resolves the global CLI flags (+ env) into ONE output mode, then applies it to
 * the shared `tux` reporter — the single source of truth for color/markers,
 * silence (`--json`), and verbosity (`--quiet`/`--verbose`). Invoked once in the
 * `preAction` hook so every command inherits it without per-command code.
 */

import {
  type Capabilities,
  type CapabilityEnv,
  detectCapabilities,
} from '@tale/shared/terminal';
import {
  configureReporter,
  setReporterLevel,
  setReporterSilent,
} from '@tale/shared/tux';

/** The global flags Commander parses on the root program. */
export interface GlobalFlags {
  /** Commander sets this `false` for `--no-color`. */
  color?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  yes?: boolean;
  json?: boolean;
  ci?: boolean;
}

interface OutputMode {
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly assumeYes: boolean;
  readonly ci: boolean;
  readonly capabilities: Capabilities;
}

/**
 * Pure: layers the flags onto an env snapshot, then runs the SAME capability
 * probe the rest of the system uses (so NO_COLOR/FORCE_COLOR/CI/TERM precedence
 * is reused, not re-implemented). `--no-color`→NO_COLOR (presence-based),
 * `--json`/`--ci`→CI (forces non-interactive, no cursor escapes),
 * `--verbose`→TALE_VERBOSE (raw passthrough, plain mode, color preserved).
 */
export function resolveOutputMode(
  flags: GlobalFlags = {},
  baseEnv: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {},
  probe: CapabilityEnv = {},
): OutputMode {
  const quiet = Boolean(flags.quiet);
  // `--quiet` wins over `--verbose`: a quiet run must never also dump the raw
  // passthrough. Normalising here keeps every downstream consumer consistent.
  const verbose = !quiet && Boolean(flags.verbose);
  const env: Record<string, string | undefined> = { ...baseEnv };
  if (flags.color === false && env.NO_COLOR === undefined) env.NO_COLOR = '';
  if (flags.ci || flags.json) env.CI = 'true';
  if (verbose) env.TALE_VERBOSE = '1';
  return {
    json: Boolean(flags.json),
    quiet,
    verbose,
    assumeYes: Boolean(flags.yes),
    ci: Boolean(flags.ci || flags.json),
    capabilities: detectCapabilities({ ...probe, env }),
  };
}

/** The single mutator — pushes the resolved mode into the shared reporter. */
export function configureOutput(mode: OutputMode): void {
  configureReporter(mode.capabilities);
  setReporterSilent(mode.json);
  setReporterLevel(mode.quiet ? 'quiet' : mode.verbose ? 'verbose' : 'normal');
}

let active: OutputMode | null = null;

/** Record the resolved mode so actions/prompts can read `assumeYes`/`json`. */
export function setActiveOutputMode(mode: OutputMode): void {
  active = mode;
}

/** The active mode, or a default-resolved one (safe for direct action unit tests). */
export function getOutputMode(): OutputMode {
  return active ?? resolveOutputMode();
}

/**
 * Consent to a destructive step comes from the command's own `-y` OR the
 * global `tale -y` (documented as 'assume yes for all prompts'). Commander
 * routes the global flag to `program.opts()`, so a command that only read its
 * local flag would prompt — and under `--yes` `confirm` returns its `default`
 * (false here), silently cancelling the very action the operator asked for.
 */
export function resolveConsent(local: boolean | undefined): boolean {
  return Boolean(local) || getOutputMode().assumeYes;
}
