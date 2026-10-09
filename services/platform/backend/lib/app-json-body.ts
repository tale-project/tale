import type { Context, Env, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { requestIdOf } from '../error-reporting.ts';
import { invalidBodyIssuesResponse } from './invalid-body-response.ts';
import { findNulByte, toWellFormedJson } from './unstorable-text.ts';

/** The sentence a body that is not JSON answers on the app door. */
export const INVALID_JSON_MESSAGE = 'The request body is not valid JSON';

/**
 * The app door's one JSON body reader, installed on `/api/app/*` in
 * `app.ts`: every handler's `c.req.json()` reads through it. Hono's reader
 * is a bare `JSON.parse`, so an empty body or a truncated one threw a
 * SyntaxError that the app-level handler answered as a 500 and reported as
 * a defect — a client mistake read as an outage. Here the parse failure
 * becomes the 400 `INVALID_JSON` in the flat envelope every door-level
 * refusal speaks (`{error, code}`, with the request id), thrown as an
 * HTTPException so the error handler passes it through unreported.
 *
 * A body that parses but carries a NUL character, which Postgres cannot
 * store (`unstorable-text.ts`), answers the app door's 400 `invalid body`,
 * naming the field. An unpaired UTF-16 surrogate becomes U+FFFD instead of
 * a refusal: the app's own forms can produce one — a length limit cutting
 * an emoji in half — and a person cannot see, let alone fix, what the
 * refusal would name. A text column stored U+FFFD for it anyway; a jsonb
 * one refused it as a 500. The REST door, whose callers are programs,
 * refuses both.
 *
 * Everything else about the read is untouched: a valid body parses as
 * before, a handler that falls back on a failed read
 * (`c.req.json().catch(() => ({}))`) still gets its fallback, and a body
 * the client stopped sending still fails with Node's `Error: aborted`, for
 * the error handler to recognise as the client leaving. An optional body
 * reads through `readOptionalAppJsonBody` below. The REST door reads its
 * bodies through `readJsonBody` (`rest/shared.ts`) instead.
 */
export function appJsonBody<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const request = c.req;
    const parse = request.json.bind(request);
    request.json = async <T>(): Promise<T> => {
      let parsed: T;
      try {
        parsed = await parse<T>();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        const requestId = requestIdOf(c);
        throw new HTTPException(400, {
          message: INVALID_JSON_MESSAGE,
          cause: error,
          res: c.json(
            {
              error: INVALID_JSON_MESSAGE,
              code: 'INVALID_JSON',
              ...(requestId === undefined ? {} : { requestId }),
            },
            400,
          ),
        });
      }
      // A NUL is refused here, naming its field, before any handler hands
      // it to the database as a 500.
      const nul = findNulByte(parsed);
      if (nul !== null) {
        const path = nul || 'body';
        const message = 'must not contain a NUL character (U+0000)';
        throw new HTTPException(400, {
          message: `${path}: ${message}`,
          res: invalidBodyIssuesResponse(c, [{ path, message }]),
        });
      }
      toWellFormedJson(parsed);
      return parsed;
    };
    await next();
  };
}

/**
 * The body of an app route whose body is OPTIONAL, read through the door's
 * reader above: nothing sent (or only whitespace) reads as `{}`, and a body
 * that is sent must be JSON — a truncated or malformed one answers the
 * door's 400 `INVALID_JSON`, as a required body does. The former
 * `c.req.json().catch(() => ({}))` read a corrupted body as an omitted one,
 * so a lone `{` duplicated a project under its default name (#3599). The
 * REST door's twin is `readOptionalJsonBody` (`rest/shared.ts`).
 */
export async function readOptionalAppJsonBody<E extends Env>(
  c: Context<E>,
): Promise<unknown> {
  // Hono keeps the text it read, so the parse below sees the same bytes.
  if ((await c.req.text()).trim() === '') return {};
  return await c.req.json<unknown>();
}
