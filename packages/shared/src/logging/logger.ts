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

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const COLOR_ENABLED =
  typeof process !== 'undefined' &&
  (process.stdout?.isTTY ?? false) &&
  !process.env.NO_COLOR;

/** ANSI palette — empty strings when color is disabled, so callers can build their own labels. */
export const ansi = {
  reset: COLOR_ENABLED ? '\x1b[0m' : '',
  bold: COLOR_ENABLED ? '\x1b[1m' : '',
  dim: COLOR_ENABLED ? '\x1b[2m' : '',
  red: COLOR_ENABLED ? '\x1b[31m' : '',
  green: COLOR_ENABLED ? '\x1b[32m' : '',
  yellow: COLOR_ENABLED ? '\x1b[33m' : '',
  blue: COLOR_ENABLED ? '\x1b[34m' : '',
  cyan: COLOR_ENABLED ? '\x1b[36m' : '',
} as const;

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

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ansi.dim,
  info: ansi.blue,
  warn: ansi.yellow,
  error: ansi.red,
};

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
  const pretty = options.pretty ?? COLOR_ENABLED;
  const threshold = LEVEL_RANK[options.level ?? 'info'];
  const allowDebug = debugEnabled(options);
  const prefix = options.namespace ? `[${options.namespace}] ` : '';

  function format(level: LogLevel, message: string): string {
    if (!pretty) return `${prefix}${message}`;
    const label = `${LEVEL_COLOR[level]}${LEVEL_LABEL[level]}${ansi.reset}`;
    return `${ansi.dim}[${timestamp()}]${ansi.reset} ${label} ${prefix}${message}`;
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
