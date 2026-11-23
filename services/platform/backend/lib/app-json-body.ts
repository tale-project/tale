import type { Context, Env, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';

import { requestIdOf } from '../error-reporting.ts';
import { describeByteCap } from './byte-cap.ts';
import { invalidBodyIssuesResponse } from './invalid-body-response.ts';
import { findNulByte, toWellFormedJson } from './unstorable-text.ts';

/** The sentence a body that is not JSON answers on the app door. */
export const INVALID_JSON_MESSAGE = 'The request body is not valid JSON';

/**
 * The most bytes a body on the app door may hold. The routes' own limits (a
 * dictation of 12,000,000 characters is the largest; a document's text is
 * a million) are checked only once the whole body has been read and parsed,
 * so without a byte limit any signed-in member could have the process hold
 * a body of any size, three times over, before a schema refused it
 * (tale-project/tale#4942). 16 MiB is above every body a route accepts.
 */
export const APP_BODY_MAX_BYTES = 16 * 1024 * 1024;

/** The one door on `/api/app` that takes a file as its body, and holds it
 * to its own limit as it passes it on (`domains/files/bounded-body.ts`). */
const FILE_DOOR = '/api/app/files/upload';

/** The sentence a body over the limit answers on the app door. */
export const BODY_TOO_LARGE_MESSAGE = `The request body exceeds the ${describeByteCap(APP_BODY_MAX_BYTES)} limit`;

/**
 * The app door's byte limit, installed on `/api/app/*` in `app.ts`. A body
 * that declares more than {@link APP_BODY_MAX_BYTES} is refused before a
 * byte of it is read, and one that declares nothing is cut at the first
 * byte past the limit: the 413 `BODY_TOO_LARGE`, in the flat envelope
 * every refusal of this door speaks. The file door is left to its own
 * limit.
 */
export function appBodyLimit<E extends Env>(): MiddlewareHandler<E> {
  const limit = bodyLimit({
    maxSize: APP_BODY_MAX_BYTES,
    onError: (c) => {
      const requestId = requestIdOf(c);
      return c.json(
        {
          error: BODY_TOO_LARGE_MESSAGE,
          code: 'BODY_TOO_LARGE',
          ...(requestId === undefined ? {} : { requestId }),
        },
        413,
      );
    },
  });
  return (c, next) => (c.req.path === FILE_DOOR ? next() : limit(c, next));
}

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
