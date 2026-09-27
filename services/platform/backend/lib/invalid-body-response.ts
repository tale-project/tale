import type { Context, Env } from 'hono';
import type { z } from 'zod';

/** One issue of a refused body, keyed by the dotted field path. */
export interface BodyIssue {
  path: string;
  message: string;
}

/** The issues of a failed parse, one per field, `body` for the root. */
export function bodyIssues(error: z.ZodError): BodyIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

function describeBodyIssues(issues: readonly BodyIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}

/** One line naming what was wrong, so the caller can fix the request. */
export function describeIssues(error: z.ZodError): string {
  return describeBodyIssues(bodyIssues(error));
}

/**
 * The 400 an app door answers when a body fails its schema: the fixed
 * `invalid body` code the dialogs branch on, a sentence naming each failed
 * field for the toast, and the issues themselves for a form that wants to
 * mark the field. Every app door answers a refused body through this (or
 * `invalidBodyIssuesResponse`), never a bare `{ error: 'invalid body' }`
 * that leaves the person — and the error report — guessing which field.
 */
export function invalidBodyResponse<E extends Env>(
  c: Context<E>,
  error: z.ZodError,
): Response {
  return invalidBodyIssuesResponse(c, bodyIssues(error));
}

/**
 * The same 400 for a refusal no schema raised: a body that is not JSON
 * (`path: 'body'`), or a rule the route checks after the parse.
 */
export function invalidBodyIssuesResponse<E extends Env>(
  c: Context<E>,
  issues: readonly BodyIssue[],
): Response {
  return c.json(
    {
      error: 'invalid body',
      message: describeBodyIssues(issues),
      data: { issues },
    },
    400,
  );
}
