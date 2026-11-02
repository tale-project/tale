// Calls the HTTP app in-process, the way the page does, for the tests of the
// routes: `Host` and a JSON `Content-Type` are set unless the test says
// otherwise, and an answer can be checked against the schema of its contract.

import type { Hono } from 'hono';
import { expect } from 'vitest';
import { z } from 'zod';

import type { ApiErrorBody } from '../../lib/api/schemas.ts';
import { createApp } from '../app.ts';
import type { AppDeps } from '../app.ts';
import { loadConfig } from '../config.ts';
import type { Manager } from '../domains/sessions/manager.ts';
import { strictManager } from './http-stub-manager.ts';

/** The address the page is served from in tests. */
export const TEST_HOST = '127.0.0.1:3004';

/** The app with the default configuration (it answers to `TEST_HOST`). */
export function testApp(
  manager: Manager,
  options: Pick<AppDeps, 'mcp'> = {},
): Hono {
  const config = loadConfig({}, { distDir: '/nonexistent' });
  return createApp({ manager, config, ...options });
}

/** A client of the app over a `strictManager`, and the stub. */
export function stubbedApi(overrides: Partial<Manager> = {}) {
  const manager = strictManager(overrides);
  return { manager, client: apiClient(testApp(manager)) };
}

export interface CallOptions {
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as it is, with the given `Content-Type` (default: none). */
  raw?: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

export interface ApiClient {
  call(method: string, path: string, options?: CallOptions): Promise<Response>;
  get(path: string, options?: CallOptions): Promise<Response>;
  post(path: string, body?: unknown, options?: CallOptions): Promise<Response>;
  patch(path: string, body?: unknown, options?: CallOptions): Promise<Response>;
  delete(path: string, options?: CallOptions): Promise<Response>;
}

export function apiClient(app: Pick<Hono, 'request'>): ApiClient {
  async function call(
    method: string,
    path: string,
    { body, raw, query, headers = {} }: CallOptions = {},
  ): Promise<Response> {
    const search = new URLSearchParams(
      Object.entries(query ?? {}).map(([key, value]) => [key, String(value)]),
    ).toString();
    const sent = new Headers({ Host: TEST_HOST });
    if (body !== undefined) sent.set('Content-Type', 'application/json');
    for (const [name, value] of Object.entries(headers)) sent.set(name, value);
    return app.request(
      `http://${TEST_HOST}${path}${search === '' ? '' : `?${search}`}`,
      {
        method,
        headers: sent,
        body: body === undefined ? raw : JSON.stringify(body),
      },
    );
  }

  return {
    call,
    get: (path, options) => call('GET', path, options),
    post: (path, body, options) => call('POST', path, { ...options, body }),
    patch: (path, body, options) => call('PATCH', path, { ...options, body }),
    delete: (path, options) => call('DELETE', path, options),
  };
}

/**
 * The JSON of an answer with the given status, parsed by the schema of its
 * contract. The schema drops what it does not name, so the answer must equal
 * what it parses to: nothing outside the contract (a password) is sent.
 */
export async function expectJson<S extends z.ZodType>(
  response: Response,
  status: number,
  schema: S,
): Promise<z.output<S>> {
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${text}`);
  }
  const body: unknown = JSON.parse(text);
  const parsed = schema.parse(body);
  expect(parsed).toEqual(body);
  return parsed;
}

const errorBodySchema = z.looseObject({
  error: z.string(),
  message: z.string(),
});

/** An error answer: the status, the code and a sentence; the body is returned. */
export async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<ApiErrorBody> {
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${text}`);
  }
  const body = errorBodySchema.parse(JSON.parse(text));
  expect(body.error).toBe(code);
  expect(body.message.length).toBeGreaterThan(0);
  return body;
}
