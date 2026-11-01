import { z } from 'zod';

import {
  ConfigError,
  ExternalToolError,
  NativeRequestError,
} from '../lib/config/releases/model';
import {
  CliError,
  ExitCode,
  externalDepError,
  preconditionError,
} from '../utils/fail';
import { fieldPath, namePlaces } from '../utils/field-paths';
import { NonInteractiveError } from '../utils/prompt';

export interface OperationalFallback {
  /** Summary for input that does not match its schema; the mismatched
   * fields are named after it. */
  schema: string;
  /** Summary for any other failure; its own message is never shown. */
  summary: string;
  next?: string | string[];
  /** Exit code of both summaries; a precondition unless the caller knows the
   * failure lies with an external dependency. */
  code?: typeof ExitCode.Precondition | typeof ExitCode.ExternalDep;
}

/**
 * The error a configuration or deployment command renders for a failure.
 *
 * Deliberate, bounded operational errors keep their own words: those messages
 * are authored, never a native response body, a credential-bearing fetch
 * error or Docker's output. Input that does not match its schema keeps the
 * caller's sentence and names each mismatched field and what it expects, never
 * a value. Anything else is replaced by the caller's fixed summary, so an
 * unexpected message cannot leak a secret into a log.
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
  const code = fallback.code ?? ExitCode.Precondition;
  if (error instanceof z.ZodError) {
    const places = mismatches(error);
    return new CliError({
      summary:
        places.length > 0
          ? `${fallback.schema} Mismatched fields: ${namePlaces(places)}.`
          : fallback.schema,
      code,
    });
  }
  return new CliError({ summary: fallback.summary, next: fallback.next, code });
}

/** Each mismatched place once, as `path (what it expects)`; an unknown key is
 * a place of its own. */
function mismatches(error: z.ZodError): string[] {
  const places = error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map(
          (key) => `${fieldPath([...issue.path, key])} (unknown field)`,
        )
      : [`${fieldPath(issue.path)} (${expectation(issue)})`],
  );
  return [...new Set(places)];
}

/** What a mismatched field should be, from the facts its schema states. Never
 * the issue's message or the values it allows: a message can quote the input,
 * and a literal or an enum can hold run-time data. */
function expectation(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return `expected ${issue.expected}`;
    case 'invalid_format':
      return issue.format === 'regex'
        ? 'does not match its pattern'
        : `expected ${issue.format}`;
    case 'too_small':
    case 'too_big': {
      const measure = ['number', 'int', 'bigint', 'date'].includes(issue.origin)
        ? issue.origin
        : `${issue.origin} length`;
      const operator = issue.exact
        ? '='
        : `${issue.code === 'too_small' ? '>' : '<'}${issue.inclusive ? '=' : ''}`;
      const limit = issue.code === 'too_small' ? issue.minimum : issue.maximum;
      return `expected ${measure} ${operator} ${limit}`;
    }
    default:
      return 'invalid';
  }
}
