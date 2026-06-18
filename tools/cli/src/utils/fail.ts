/**
 * Typed CLI errors + the single failure renderer with stable exit codes.
 *
 * An action that knows its failure class throws a {@link CliError} (or one of the
 * convenience constructors); the central dispatch in `run-command.ts` maps it to
 * the right exit code and renders `✗ summary` + `Cause:` + copy-pasteable `Try:`.
 */

import { detailLines, errorLine } from '@tale/shared/tux';

import { getOutputMode } from './output-mode';

/** Stable process exit codes — scripts/CI can branch on the failure class. */
export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Usage: 2,
  /** Docker down, no project, port busy — a precondition the user can fix. */
  Precondition: 3,
  /** Ctrl-C / a required prompt in a non-interactive shell. */
  UserAbort: 4,
  /** A failing external dependency (registry, network, docker daemon). */
  ExternalDep: 5,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface FailInfo {
  /** One-line cause, rendered as `✗ <summary>`. */
  summary: string;
  cause?: string | Error;
  /** Copy-pasteable next steps, rendered under `Try:`. */
  next?: string | string[];
  code?: Exclude<ExitCode, typeof ExitCode.Ok>;
}

/** A CLI error carrying an exit code + actionable next-steps. */
export class CliError extends Error {
  readonly info: FailInfo;
  constructor(info: FailInfo) {
    super(info.summary);
    this.name = 'CliError';
    this.info = info;
  }
}

export function preconditionError(
  summary: string,
  next?: string | string[],
): CliError {
  return new CliError({ summary, next, code: ExitCode.Precondition });
}

export function externalDepError(summary: string, cause?: Error): CliError {
  return new CliError({ summary, cause, code: ExitCode.ExternalDep });
}

export function usageError(
  summary: string,
  next?: string | string[],
): CliError {
  return new CliError({ summary, next, code: ExitCode.Usage });
}

export function causeText(cause?: string | Error): string {
  if (cause === undefined) return '';
  return cause instanceof Error ? cause.message : cause;
}

/** Render the failure through the reporter and exit with its code. */
export function failWith(info: FailInfo): never {
  errorLine(info.summary);
  const detail: string[] = [];
  if (info.cause) detail.push(`Cause: ${causeText(info.cause)}`);
  if (
    getOutputMode().verbose &&
    info.cause instanceof Error &&
    info.cause.stack
  ) {
    detail.push(...info.cause.stack.split('\n').slice(1));
  }
  const tries = info.next ? [info.next].flat() : [];
  if (tries.length > 0) detail.push('Try:', ...tries.map((t) => `  ${t}`));
  if (detail.length > 0) detailLines(detail);
  process.exit(info.code ?? ExitCode.Generic);
}
