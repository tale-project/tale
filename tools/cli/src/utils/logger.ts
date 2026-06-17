/**
 * CLI terminal output, built on the one reusable `@tale/shared` logger.
 *
 * The leveled methods (`info`/`warn`/`error`/`debug`) delegate to the shared
 * factory in pretty mode, so the CLI shares the single logging approach. The
 * extras below (`success`/`step`/`notice`/`header`/`table`/`bannerText`/…) are
 * interactive-terminal presentation, layered on the same `ansi` palette +
 * `timestamp` so every line stays visually consistent.
 */

import { ansi, createLogger, timestamp } from '@tale/shared/logging/logger';

const log = createLogger({ pretty: true });

export function info(message: string) {
  log.info(message);
}

export function warn(message: string) {
  log.warn(message);
}

export function error(message: string) {
  log.error(message);
}

export function debug(message: string) {
  log.debug(message);
}

export function success(message: string) {
  console.log(
    `${ansi.dim}[${timestamp()}]${ansi.reset} ${ansi.green}${ansi.bold}OK${ansi.reset}    ${message}`,
  );
}

export function step(message: string) {
  console.log(
    `${ansi.dim}[${timestamp()}]${ansi.reset} ${ansi.cyan}STEP${ansi.reset}  ${message}`,
  );
}

export function notice(message: string) {
  console.log(
    `${ansi.dim}[${timestamp()}]${ansi.reset} ${ansi.yellow}${ansi.bold}NOTE${ansi.reset}  ${ansi.yellow}${message}${ansi.reset}`,
  );
}

export function containerLog(service: string, line: string) {
  const truncated = line.length > 200 ? `${line.slice(0, 200)}...` : line;
  console.log(
    `  ${ansi.dim}[${service}]${ansi.reset} ${ansi.dim}${truncated}${ansi.reset}`,
  );
}

export function blank() {
  console.log();
}

export function header(title: string) {
  blank();
  console.log(`${ansi.bold}${ansi.cyan}=== ${title} ===${ansi.reset}`);
  blank();
}

export function table(rows: [string, string][]) {
  const maxKeyLength = Math.max(...rows.map(([key]) => key.length));
  for (const [key, value] of rows) {
    console.log(
      `  ${key.padEnd(maxKeyLength)}  ${ansi.dim}${value}${ansi.reset}`,
    );
  }
}

/**
 * A small, tasteful wordmark shown for bare `tale` and `--help`. Intentionally
 * minimal — no heavy ASCII art, no extra deps.
 */
export function bannerText(version: string): string {
  return `  ${ansi.bold}${ansi.cyan}◆ Tale${ansi.reset} ${ansi.dim}v${version}${ansi.reset}  ${ansi.dim}— your self-hosted AI workforce${ansi.reset}`;
}
