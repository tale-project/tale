import type { z } from 'zod';

import { isRecord } from '@/lib/is-record';

/**
 * A failed call to the session manager: the HTTP status, the backend's stable
 * code (`session_not_found`, …) and its own sentence as the message. A call
 * that got no answer has status 0 and the code `network`. Two codes are made
 * here, not sent by the backend, so that every failure has words in the
 * person's language (`errors.<code>`): `server_error`, an answer that is no
 * error of the backend's (a gateway's error page), and `bad_answer`, an answer
 * the page cannot read. The message is for developers and never shown.
 *
 * The extra fields of the answer (the session that holds a proxy, the exit IP
 * two sessions share) are on `extra`, not `data`: an error with a `data`
 * property is a structured error that `readableErrorMessage` refuses to print.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

async function readError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy's error page): the status says what there is to say.
    body = null;
  }
  if (isRecord(body) && typeof body.error === 'string') {
    const { error, message, ...extra } = body;
    return new ApiError(
      response.status,
      error,
      typeof message === 'string' ? message : error,
      extra,
    );
  }
  // Not an answer of the backend (a proxy's error page, a body of another
  // shape): the status says what there is to say, and the page words it.
  return new ApiError(
    response.status,
    'server_error',
    `HTTP ${response.status}`,
    { status: response.status },
  );
}

/** An answer the page cannot read, however it came to be so. */
function unreadable(response: Response, why: string): ApiError {
  return new ApiError(response.status, 'bad_answer', why);
}

/** The JSON of an answer, or a `bad_answer` when it is none (the page of a server that is not ours). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw unreadable(response, 'The answer is not JSON.');
  }
}

/** A value of an answer, parsed by `schema`, or a `bad_answer` carrying what did not fit in the console. */
function parseAnswer<S extends z.ZodType>(
  schema: S,
  value: unknown,
  response: Response,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.warn('The answer does not have the expected shape.', parsed.error);
  throw unreadable(response, 'The answer does not have the expected shape.');
}

/** Calls an API path; rejects with an `ApiError` unless the answer is a success. */
async function call(
  method: string,
  path: string,
  { body, query, signal }: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`/api${withQuery(path, query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'network', 'Cannot reach the session manager.');
  }
  if (!response.ok) throw await readError(response);
  return response;
}

/** The answer of a call, parsed by `schema`. */
export async function apiJson<S extends z.ZodType>(
  schema: S,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await call(method, path, options);
  return parseAnswer(schema, await readJson(response), response);
}

/** A call that answers with no body. */
export async function apiVoid(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  await call(method, path, options);
}

export interface ListResult<T> {
  items: T[];
  /** The number of rows in the whole list (`X-Total-Count`). */
  total: number;
}

/** A part of a list, and the size of the whole list. */
export async function apiList<S extends z.ZodType>(
  itemSchema: S,
  path: string,
  options: RequestOptions = {},
): Promise<ListResult<z.output<S>>> {
  const response = await call('GET', path, options);
  const items: z.output<S>[] = [];
  const body = await readJson(response);
  if (!Array.isArray(body))
    throw unreadable(response, 'The answer is no list.');
  for (const item of body) items.push(parseAnswer(itemSchema, item, response));
  const header = Number(response.headers.get('X-Total-Count'));
  return {
    items,
    total:
      Number.isFinite(header) && header >= items.length ? header : items.length,
  };
}
