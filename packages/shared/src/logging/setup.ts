/**
 * Service logging helpers, built on the one reusable {@link createLogger}.
 *
 * `configureLogging` returns a logger from the shared factory; `shouldLogAccess`
 * is the `GET /health` access-log suppression predicate that an access-logging
 * middleware consults before emitting a line.
 */

import { createLogger, type Logger, type LogLevel } from './logger';

export interface LoggingOptions {
  /** Log level (`debug`, `info`, `warn`, `error`). Case-insensitive. */
  level?: string;
  /** Namespace tag prefixed to each line. */
  namespace?: string;
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function normalizeLevel(level: string | undefined): LogLevel {
  const candidate = (level ?? 'info').toLowerCase();
  return LEVELS.find((l) => l === candidate) ?? 'info';
}

/**
 * Drop access-log lines for the health endpoint. Returns false (suppress) when
 * the log message concerns a `GET /health` request.
 */
export function shouldLogAccess(message: string): boolean {
  return !message.includes('GET /health');
}

/** Build a logger with consistent settings across services. */
export function configureLogging(options: LoggingOptions = {}): Logger {
  return createLogger({
    level: normalizeLevel(options.level),
    namespace: options.namespace,
  });
}
