import type { Env, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { requestIdOf } from '../error-reporting.ts';

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
 * Everything else about the read is untouched: a valid body parses as
 * before, a handler that falls back on a failed read
 * (`c.req.json().catch(() => ({}))`) still gets its fallback, and a body
 * the client stopped sending still fails with Node's `Error: aborted`, for
 * the error handler to recognise as the client leaving. The REST door
 * reads its bodies through `readJsonBody` (`rest/shared.ts`) instead.
 */
export function appJsonBody<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const request = c.req;
    const parse = request.json.bind(request);
    request.json = async <T>(): Promise<T> => {
      try {
        return await parse<T>();
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
    };
    await next();
  };
}
