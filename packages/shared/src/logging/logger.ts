/**
 * The one reusable Tale logger.
 *
 * A single dependency-free, `console`-backed logger used everywhere: platform
 * Convex node-actions (Convex captures `console.*` into function logs), the CLI
 * (pretty TTY output), and any standalone service. Replaces the three divergent
 * `logger.ts` implementations that had grown up (a pino service logger, a Convex
 * console shim, and the CLI's ad-hoc colored logger).
 *
 *   const log = createLogger({ namespace: 'knowledge' });   // console, level-gated
 *   const cli = createLogger({ pretty: true });             // colored TTY output
 *
 * Levels: debug < info < warn < error. `debug` is suppressed unless the level is
 * `debug`, `DEBUG` is set, or the per-logger `debugEnvVar` is set — so verbose
 * call sites stay quiet in production without code changes.
 */

import { makePalette, type Palette } from '../terminal/ansi';
import { detectCapabilities } from '../terminal/capabilities';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Color is derived from the ONE shared capability probe (NO_COLOR / FORCE_COLOR
// / CI / TERM=dumb / Windows-legacy precedence) — never a private `isTTY &&
// !NO_COLOR` rule, which used to disagree with the reporter and produce
// "logger and reporter render different colors" bugs. Both `term/capabilities`
// and `term/ansi` are node-free, so the logger stays Convex-V8-reachable (the
// boundary test enforces it).
//
// `ansi` is evaluated once at import for back-compat; `createLogger` re-derives
// per call so a mid-process `NO_COLOR`/`FORCE_COLOR` change is honored and tests
// can drive it.
/** ANSI palette — empty strings when color is disabled, so callers can build their own labels. */
export const ansi: Palette = makePalette(detectCapabilities().color);

export interface CreateLoggerOptions {
  /** Tag prefixed to every line, e.g. `knowledge` → `[knowledge] …`. */
  namespace?: string;
  /** Minimum level to emit. Default `info`. */
  level?: LogLevel;
  /** Colored, timestamped output for an interactive terminal. Default: auto (TTY && !NO_COLOR). */
  pretty?: boolean;
  /** When this env var is set (truthy), lower the threshold to `debug` for this logger. */
  debugEnvVar?: string;
}

export interface Logger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
  /** Derive a logger with an extended namespace, inheriting all other options. */
  child(namespace: string): Logger;
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

function levelColors(palette: Palette): Record<LogLevel, string> {
  return {
    debug: palette.dim,
    info: palette.blue,
    warn: palette.yellow,
    error: palette.red,
  };
}

function debugEnabled(options: CreateLoggerOptions): boolean {
  if ((options.level ?? 'info') === 'debug') return true;
  if (typeof process === 'undefined') return false;
  if (process.env.DEBUG) return true;
  return Boolean(options.debugEnvVar && process.env[options.debugEnvVar]);
}

/** `HH:MM:SS` for log-line prefixes; shared so presentation layers (CLI) match. */
export function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  // Re-derive capabilities per call so a mid-process NO_COLOR/FORCE_COLOR change
  // is honored (and tests can drive it) — the one source of truth, not a frozen
  // module-load palette.
  const color = detectCapabilities().color;
  const palette = makePalette(color);
  const levelColor = levelColors(palette);
  const pretty = options.pretty ?? color;
  const threshold = LEVEL_RANK[options.level ?? 'info'];
  const allowDebug = debugEnabled(options);
  const prefix = options.namespace ? `[${options.namespace}] ` : '';

  function format(level: LogLevel, message: string): string {
    if (!pretty) return `${prefix}${message}`;
    const label = `${levelColor[level]}${LEVEL_LABEL[level]}${palette.reset}`;
    return `${palette.dim}[${timestamp()}]${palette.reset} ${label} ${prefix}${message}`;
  }

  function emit(level: LogLevel, message: string, rest: unknown[]): void {
    if (level === 'debug' ? !allowDebug : LEVEL_RANK[level] < threshold) return;
    const line = format(level, message);
    if (level === 'error') console.error(line, ...rest);
    else if (level === 'warn') console.warn(line, ...rest);
    else console.log(line, ...rest);
  }

  return {
    debug: (message, ...rest) => emit('debug', message, rest),
    info: (message, ...rest) => emit('info', message, rest),
    warn: (message, ...rest) => emit('warn', message, rest),
    error: (message, ...rest) => emit('error', message, rest),
    child: (namespace) =>
      createLogger({
        ...options,
        namespace: options.namespace
          ? `${options.namespace}:${namespace}`
          : namespace,
      }),
  };
}
