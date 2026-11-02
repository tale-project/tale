// What the routes read of a request, each checked before a route uses it: the
// JSON body, the query and the id in the path. A check that fails throws the
// `ZodError` (answered as a 422 `validation_error`, see `app.ts`) or an
// `AppError`; a route never answers a bad request itself.

import { Buffer } from 'node:buffer';

import type { Context } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors.ts';

/** What an id in a path can name. */
export type Entity = 'session' | 'proxy' | 'secret';

const NOUNS: Record<Entity, string> = {
  session: 'Session',
  proxy: 'Proxy',
  secret: 'Secret',
};

/** The 404 for an id that names nothing: the manager's wording and code. */
export function notFound(entity: Entity, id: string | number): AppError {
  return new AppError(
    404,
    `${entity}_not_found`,
    `${NOUNS[entity]} ${id} does not exist.`,
  );
}

// A body that is not JSON fails like a body that does not fit its schema, so
// the client gets one kind of refusal.
const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'The request body is not valid JSON.',
    });
    return z.NEVER;
  }
});

/**
 * The most bytes of a request body the app reads: the API and the MCP endpoint.
 * The largest thing a person sends is a list of proxies or a secret with all
 * its values (a few hundred kilobytes); Bun's own limit is 128 MiB.
 */
export const MAX_BODY_BYTES = 1024 * 1024;

function bodyTooLarge(limit: number): AppError {
  return new AppError(
    413,
    'validation_error',
    `The request body is larger than ${limit} bytes.`,
  );
}

/**
 * The body of a request as UTF-8 text. A body over `limit` bytes is refused
 * with a 413 as soon as that is known: from `Content-Length` without reading
 * a byte, else while reading (a chunked body announces nothing), when the
 * rest is let go of.
 */
export async function readBodyText(
  request: Request,
  limit = MAX_BODY_BYTES,
): Promise<string> {
  if (Number(request.headers.get('content-length')) > limit) {
    throw bodyTooLarge(limit);
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw bodyTooLarge(limit);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The body as JSON; `undefined` when none was sent. */
async function readJson(c: Context): Promise<unknown> {
  const text = await readBodyText(c.req.raw);
  return text.trim() === '' ? undefined : jsonText.parse(text);
}

/** The JSON body, which must be there and fit `schema`. */
export async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  return schema.parse(await readJson(c));
}

/** Like `parseBody`, for a body that may be left out (or be `null`): `{}`. */
export async function parseOptionalBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  return schema.parse((await readJson(c)) ?? {});
}

/** The query string, checked by `schema` (which coerces the numbers). */
export function parseQuery<S extends z.ZodType>(
  c: Context,
  schema: S,
): z.output<S> {
  return schema.parse(c.req.query());
}

/** A flag in a query string, worded the way FastAPI took them. */
export const queryBoolean = z.stringbool({
  truthy: ['1', 'on', 't', 'true', 'y', 'yes'],
  falsy: ['0', 'off', 'f', 'false', 'n', 'no'],
});

const idParamSchema = z.object({
  id: z
    .string()
    .regex(
      /^[+-]?\d+$/,
      'Input should be a valid integer, unable to parse string as an integer',
    ),
});

/**
 * The `:id` of the path. Text that is not a whole number is a 422. A whole
 * number that no row can have (below 1, or too large to be a safe integer) is
 * an id like any other that names nothing: a 404, without asking the manager.
 */
export function pathId(c: Context, entity: Entity): number {
  const { id: text } = idParamSchema.parse({ id: c.req.param('id') });
  const id = Number(text);
  if (Number.isSafeInteger(id) && id >= 1) return id;
  throw notFound(entity, Number.isSafeInteger(id) ? id : text);
}
