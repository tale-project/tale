import { z } from 'zod';

import {
  ConfigError,
  ExternalToolError,
  NativeRequestError,
} from '../lib/config/releases/model';
import { CliError, externalDepError, preconditionError } from '../utils/fail';
import { NonInteractiveError } from '../utils/prompt';

export interface OperationalFallback {
  /** Summary for input that does not match its schema. */
  schema: string;
  /** Summary for any other failure; its own message is never shown. */
  summary: string;
  next?: string | string[];
}

/**
 * The error a configuration or deployment command renders for a failure.
 *
 * Deliberate, bounded operational errors keep their own words: those messages
 * are authored, never a native response body, a credential-bearing fetch
 * error or Docker's output. Anything else is replaced by the caller's fixed
 * summary, so an unexpected message cannot leak a secret into a log.
 */
export function operationalFailure(
  error: unknown,
  fallback: OperationalFallback,
): Error {
  if (error instanceof CliError || error instanceof NonInteractiveError)
    return error;
  if (error instanceof NativeRequestError || error instanceof ExternalToolError)
    return externalDepError(error.message);
  if (error instanceof ConfigError) return preconditionError(error.message);
  if (error instanceof z.ZodError) return preconditionError(fallback.schema);
  return preconditionError(fallback.summary, fallback.next);
}
