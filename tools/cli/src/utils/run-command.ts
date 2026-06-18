/**
 * The central command dispatch: wrap a Commander action with `action(body)` so
 * every command shares ONE error path — typed `CliError`s map to their exit code,
 * a user abort (Ctrl-C / a required prompt in a non-interactive shell) exits `4`
 * quietly, and anything else is a generic failure. In `--json` mode the error is
 * emitted as a JSON envelope instead of human chrome. Replaces the per-command
 * `try/catch + process.exit(1)` boilerplate.
 */

import { errorLine } from '@tale/shared/tux';

import { isUserInterrupt } from './exit-codes';
import { CliError, ExitCode, failWith } from './fail';
import { emitJsonError } from './json-output';
import { getOutputMode } from './output-mode';
import { NonInteractiveError } from './prompt';

function isUserAbort(err: unknown): boolean {
  if (err instanceof NonInteractiveError) return true;
  if (typeof err === 'object' && err !== null && 'exitCode' in err) {
    const code = err.exitCode; // narrowed to `unknown` by the `in` guard
    return typeof code === 'number' && isUserInterrupt(code);
  }
  return false;
}

/** Map any thrown value to a rendered failure + the right exit code. Never returns. */
export function handleError(err: unknown): never {
  const mode = getOutputMode();

  if (isUserAbort(err)) {
    if (!mode.json) errorLine('Aborted.');
    process.exit(ExitCode.UserAbort);
  }

  if (err instanceof CliError) {
    if (mode.json) emitJsonError(err.info);
    failWith(err.info);
  }

  const e = err instanceof Error ? err : new Error(String(err));
  const info = { summary: e.message, cause: e, code: ExitCode.Generic };
  if (mode.json) emitJsonError(info);
  failWith(info);
}

/** Wrap a command body so a thrown error flows through {@link handleError}. */
export function action<A extends unknown[]>(
  body: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await body(...args);
    } catch (err) {
      handleError(err);
    }
  };
}
