// Shared test helpers for the WebDAV handler connector suite. Owns
// the ConvexHttpClient stub, the Basic-auth credential plumbing (HMAC
// matches what `handler.ts` reads from the env), and the
// WebDAVRequest builder.

import type { ConvexHttpClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { XMLParser } from 'fast-xml-parser';

import { AppError } from '../shared/errors/app-error';
import type { WebDAVCtx, WebDAVRequest } from './types';

// Same shape `handler.ts:getHmacSecret()` expects: 32+ chars of hex.
// Fixed value (not random) so the same precomputed HMAC works across
// every test run.
const TEST_HMAC_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const TEST_ORG_SLUG = 'myorg';
export const TEST_ORG_ID = 'org_test_123';
export const TEST_USER_ID = 'user_test_123';
const TEST_APP_PASSWORD_ID = 'app_pass_test_123';
const TEST_USERNAME = 'webdav-user';
const TEST_PASSWORD = 'app-pass-1234-5678-90ab';

export function setupHmacEnv(): void {
  process.env.WEBDAV_APP_PASSWORD_HMAC_KEY = TEST_HMAC_KEY;
}

// Per-test stub registry. Each entry maps a Convex function name
// (e.g. "webdav/tree_queries:resolvePath") to a handler that takes the
// args object and returns the desired result (or throws).
type StubHandler = (args: unknown) => unknown;

interface StubOverrides {
  queries?: Record<string, StubHandler>;
  mutations?: Record<string, StubHandler>;
}

// Build a minimal `ConvexHttpClient` shape that satisfies WebDAVCtx.
// query/mutation look up by canonical name; unknown names raise so
// tests can't silently pass against an unmocked code path.
export function makeStubCtx(overrides: StubOverrides = {}): WebDAVCtx {
  const queries: Record<string, StubHandler> = {
    // Default auth wiring — every test that authenticates expects
    // these to succeed. Tests can override (e.g. forbidden-membership)
    // by passing their own queries map.
    'webdav/org_queries:resolveOrgAndCheckMembership': (args) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stub args are shaped by callers in tests
      const a = args as { orgSlug: string; userId: string };
      if (a.orgSlug !== TEST_ORG_SLUG) return null;
      // Initial probe (userId === '') confirms the org exists; the
      // post-match probe (userId === TEST_USER_ID) confirms membership.
      if (a.userId === '' || a.userId === TEST_USER_ID) {
        return { organizationId: TEST_ORG_ID };
      }
      return null;
    },
    // findCandidatesByPrefix is a read-only internalQuery (auth.ts calls
    // ctx.convex.query). Default returns the one valid candidate whose
    // hashed password matches our test password.
    'webdav/app_password_queries:findCandidatesByPrefix': async () => {
      return [
        {
          _id: TEST_APP_PASSWORD_ID,
          userId: TEST_USER_ID,
          passwordHashed: await hmacHashHex(TEST_PASSWORD, TEST_HMAC_KEY),
        },
      ];
    },
    // No descendant locks by default (DELETE/MOVE of a collection).
    'webdav/lock_queries:findLocksUnderPath': () => [],
    ...overrides.queries,
  };
  const mutations: Record<string, StubHandler> = {
    // Failed-auth throttle charge — default to "not rate limited" (null).
    // Override to throw AppError({ code: 'RATE_LIMITED' }) to exercise
    // the throttled path.
    'webdav/app_password_queries:chargeWebdavAuthFailure': () => null,
    'webdav/app_password_mutations:recordAppPasswordUse': () => null,
    // Lock cleanup after DELETE/MOVE — no-op in tests.
    'webdav/lock_mutations:deleteLocksUnderPath': () => null,
    ...overrides.mutations,
  };

  const dispatchByName = (
    table: Record<string, StubHandler>,
    ref: unknown,
    args: unknown,
  ) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getFunctionName is happy with any anyApi-derived ref
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    const handler = table[name];
    if (!handler) {
      throw new Error(`Unstubbed Convex call: ${name}`);
    }
    return Promise.resolve(handler(args));
  };

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- duck-typed stub satisfies the two methods handlers exercise
  const fakeConvex = {
    query: (ref: unknown, args: unknown) => dispatchByName(queries, ref, args),
    mutation: (ref: unknown, args: unknown) =>
      dispatchByName(mutations, ref, args),
  } as unknown as ConvexHttpClient;

  return {
    convex: fakeConvex,
    storageBaseUrl: 'http://localhost:3211',
    convexApiUrl: 'http://localhost:3210',
  };
}

interface MakeRequestOptions {
  method: string;
  pathname: string;
  headers?: Record<string, string>;
  body?: string;
  authenticated?: boolean;
}

// Build a WebDAVRequest with optional authenticated Basic header
// pre-filled. body is consumed by readText/readBytes; we don't model
// streaming here because the tested handlers either treat the body as
// XML (small) or skip it entirely.
export function makeRequest(opts: MakeRequestOptions): WebDAVRequest {
  const headers = new Headers(opts.headers ?? {});
  if (opts.authenticated && !headers.has('authorization')) {
    headers.set('authorization', basicAuth(TEST_USERNAME, TEST_PASSWORD));
  }
  const bodyText = opts.body ?? '';
  return {
    method: opts.method,
    url: `http://localhost${opts.pathname}`,
    pathname: opts.pathname,
    headers,
    body: null,
    async readText() {
      return bodyText;
    },
    async readBytes() {
      return new TextEncoder().encode(bodyText);
    },
  };
}

// Basic-auth header for the default test credentials — for tests that
// drive the adapters through a real socket (no makeRequest shortcut).
export function defaultBasicAuthHeader(): string {
  return basicAuth(TEST_USERNAME, TEST_PASSWORD);
}

function basicAuth(user: string, pass: string): string {
  const utf8 = new TextEncoder().encode(`${user}:${pass}`);
  // btoa requires a binary string; round-trip through char codes.
  let binary = '';
  for (const b of utf8) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

async function hmacHashHex(
  plaintext: string,
  secretHex: string,
): Promise<string> {
  const keyBytes = hexToBytes(secretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(plaintext),
  );
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  // Allocate over an explicit ArrayBuffer (not SharedArrayBuffer) so
  // the result is usable as a BufferSource for crypto.subtle.
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// Re-export so tests can compare against the same code referenced in
// move/etc. without re-importing convex/values directly.
export { AppError };

// Read a WebDAVResponse body as text. Handlers occasionally return
// Uint8Array or null; we collapse those for assertion convenience.
export async function bodyToText(body: unknown): Promise<string> {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof Blob) return await body.text();
  // ReadableStream fallback. We never expect to hit this in handler
  // tests because the streamed paths (GET proxy, PUT upload) are
  // intentionally excluded from this suite.
  throw new Error('Unsupported body type in test helper');
}

// Reusable XML parser that strips namespaces so tests can match on
// short tag names (e.g. "multistatus" rather than "D:multistatus").
export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  // Preserve repeated `<response>` blocks as an array so tests can
  // assert lengths cleanly.
  isArray: (name) => name === 'response' || name === 'propstat',
});
