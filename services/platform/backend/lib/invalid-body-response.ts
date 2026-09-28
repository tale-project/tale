import type { Context, Env } from 'hono';
import type { z } from 'zod';

/** One issue of a refused body, keyed by the dotted field path. */
export interface BodyIssue {
  path: string;
  message: string;
}

/**
 * The reason one issue states. A field that was not sent "is required" —
 * not zod's type mismatch with `undefined` ("Invalid input: expected
 * number, received undefined") — on the app doors and the REST door alike
 * (both list through `listIssues`). A schema's own sentence for an absent
 * field is kept as written.
 */
export function issueReason(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 && issue.message.endsWith('received undefined')
    ? 'is required'
    : issue.message;
}

/** How many issues one refusal lists — enough to fix a body in one round
 * trip, never a hostile body echoed back at length. The app doors and the
 * REST door share it. */
export const MAX_BODY_ISSUES = 20;

/**
 * The problems of a failed parse, as `{path, message}` with the root at
 * path `''`, at most `MAX_BODY_ISSUES` of them. zod reports every unknown
 * key of a strict object as ONE issue whose message lists them all; each
 * key is named as its own problem (`unknownKey` is its message), so a
 * client can fix what was named and the bound holds for a body of
 * thousands of unknown keys. The REST door's `schemaIssues` and the app
 * doors' `bodyIssues` both list through here.
 */
export function listIssues(error: z.ZodError, unknownKey: string): BodyIssue[] {
  return error.issues
    .flatMap((issue) =>
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => ({
            path: [...issue.path.map(String), key].join('.'),
            message: unknownKey,
          }))
        : [
            {
              path: issue.path.map(String).join('.'),
              message: issueReason(issue),
            },
          ],
    )
    .slice(0, MAX_BODY_ISSUES);
}

/** The issues of a failed parse, one per field and per unknown key, `body`
 * for the root, at most `MAX_BODY_ISSUES` of them. */
export function bodyIssues(error: z.ZodError): BodyIssue[] {
  return listIssues(error, 'is not a field this body takes').map((issue) => ({
    path: issue.path || 'body',
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
  const listed = issues.slice(0, MAX_BODY_ISSUES);
  return c.json(
    {
      error: 'invalid body',
      message: describeBodyIssues(listed),
      data: { issues: listed },
    },
    400,
  );
}
