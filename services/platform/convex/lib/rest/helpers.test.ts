import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpCtx } from './helpers';
import {
  authenticateRequest,
  BadRequestError,
  httpStatusForConvexCode,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalStringArray,
  optionalStringArrayOrNull,
  parsePageLimit,
  readJsonObject,
  readJsonObjectOrEmpty,
  requiredString,
} from './helpers';

// `authenticateRequest` resolves identity through Better Auth; stub `createAuth`
// so the tests drive the session result directly without the real auth stack.
const getSession = vi.fn();
vi.mock('../../auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession } })),
}));

function bearerRequest(token: string): Request {
  return new Request('https://app.example.com/api/v1/agents', {
    headers: { authorization: `Bearer ${token}` },
  });
}

function ctxWith(runMutation: ReturnType<typeof vi.fn>): HttpCtx {
  return { runMutation } as unknown as HttpCtx;
}

/**
 * The REST wrapper (`withRestAuth`) maps typed `ConvexError` codes to HTTP
 * statuses via `httpStatusForConvexCode`; any code resolving to a 4xx is
 * forwarded to the client, everything else falls through to a generic 500.
 *
 * `validateProductFields` throws `ConvexError({ code: 'too_long' })` on the
 * REST product write paths (`POST`/`PATCH /api/v1/products`), so `too_long`
 * must map to 400 — otherwise an over-length client input surfaces as a 500
 * (server error) instead of a 400 (client error).
 */
describe('httpStatusForConvexCode', () => {
  it('maps over-length input (too_long) to 400, not 500', () => {
    expect(httpStatusForConvexCode('too_long')).toBe(400);
  });

  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['validation', 400],
  ])('maps %s to %i', (code, status) => {
    expect(httpStatusForConvexCode(code)).toBe(status);
  });

  it.each([[undefined], ['something_unrecognized']])(
    'falls through to 500 for unrecognized code %s',
    (code) => {
      expect(httpStatusForConvexCode(code)).toBe(500);
    },
  );

  /**
   * Every code the REST surfaces actually throw has a row here. A code that
   * falls through to 500 turns a client's mistake into "server error", which is
   * both wrong and unactionable — so the mapping is part of the endpoint
   * contract, not a nicety.
   */
  it.each([
    // Automations
    ['AUTOMATION_NOT_DEPLOYED', 409],
    ['AUTOMATION_DEPLOY_REJECTED', 409],
    ['AUTOMATION_SAVE_REJECTED', 400],
    ['AUTOMATION_TRIGGER_REJECTED', 400],
    ['AUTOMATION_RUN_NOT_FOUND', 404],
    // Capability and membership refusals
    ['FORBIDDEN_DEVELOPER_SETTINGS', 403],
    ['ORG_FORBIDDEN', 403],
    ['ORG_NOT_FOUND', 404],
    // Chat threads filed under a project
    ['PROJECT_FORBIDDEN', 403],
    ['PROJECT_NOT_FOUND', 404],
    // Config-tree domains (agents, skills)
    ['AGENT_FORBIDDEN', 403],
    ['SKILL_FORBIDDEN', 403],
    ['INVALID_AGENT_SLUG', 400],
    ['INVALID_SKILL_SLUG', 400],
    ['INVALID_AGENT', 400],
    ['INVALID_SKILL', 400],
    // Knowledge entries and retrieval
    ['KNOWLEDGE_ENTRY_NOT_FOUND', 404],
    ['KNOWLEDGE_ENTRY_NOT_ACTIVE', 409],
    ['KNOWLEDGE_ENTRY_DUPLICATE', 409],
    ['KNOWLEDGE_ENTRY_TOPIC_REQUIRED', 400],
    ['KNOWLEDGE_ENTRY_TOPIC_TOO_LONG', 400],
    ['KNOWLEDGE_ENTRY_CONTENT_REQUIRED', 400],
    ['KNOWLEDGE_ENTRY_CONTENT_TOO_LONG', 400],
    ['KNOWLEDGE_EMBEDDING_NOT_CONFIGURED', 409],
    // Controlled-document generic writers must use the attested replacement.
    ['DOCUMENT_RECORD_REPLACEMENT_REQUIRED', 409],
    // Pre-existing surfaces whose codes were unmapped (contacts, products,
    // websites all threw these from paths REST calls).
    ['CONTACT_NOT_FOUND', 404],
    ['CONTACT_DUPLICATE_EMAIL', 409],
    ['CONTACT_DUPLICATE_EXTERNAL_ID', 409],
    ['DUPLICATE_PRODUCT_NAME', 409],
    ['CRAWLER_WEBSITE_NOT_FOUND', 404],
    ['INVALID_SCAN_INTERVAL', 400],
    ['invalid_locale', 400],
  ])('maps %s to %i', (code, status) => {
    expect(httpStatusForConvexCode(code)).toBe(status);
  });

  /**
   * The vendors/customers domains are gone; their codes were dead rows in this
   * table. `EMAIL_REQUIRED` had no producer left either. They fall through to
   * the 500 path now, which is where an unrecognized code belongs — kept as a
   * test so a future re-add is a deliberate act.
   */
  it.each([
    ['VENDOR_NOT_FOUND'],
    ['CUSTOMER_NOT_FOUND'],
    ['VENDOR_DUPLICATE_EMAIL'],
    ['CUSTOMER_DUPLICATE_EMAIL'],
    ['VENDOR_DUPLICATE_EXTERNAL_ID'],
    ['CUSTOMER_DUPLICATE_EXTERNAL_ID'],
    ['EMAIL_REQUIRED'],
  ])('no longer recognizes the retired code %s', (code) => {
    expect(httpStatusForConvexCode(code)).toBe(500);
  });
});

describe('parsePageLimit', () => {
  function url(query: string): URL {
    return new URL(`https://tale.test/api/v1/things${query}`);
  }

  it.each([
    ['', 25],
    ['?limit=10', 10],
    ['?limit=0', 1],
    ['?limit=-5', 1],
    ['?limit=9999', 100],
    ['?limit=abc', 25],
    ['?limit=7.9', 7],
  ])('clamps %s to %i', (query, expected) => {
    expect(parsePageLimit(url(query), 25, 100)).toBe(expected);
  });
});

/**
 * Boundary validation. Every reader below refuses rather than coerces, because a
 * silently coerced field is a request the caller never made — and the wrapper
 * turns the refusal into a 400 instead of letting it reach a mutation.
 */
describe('request-body readers', () => {
  function jsonRequest(body: string): Request {
    return new Request('https://tale.test/api/v1/things', {
      method: 'POST',
      body,
    });
  }

  it('reads a JSON object and refuses everything else', async () => {
    await expect(readJsonObject(jsonRequest('{"a":1}'))).resolves.toEqual({
      a: 1,
    });
    for (const body of ['[]', '"text"', '7', 'null', 'not json', '']) {
      await expect(readJsonObject(jsonRequest(body))).rejects.toBeInstanceOf(
        BadRequestError,
      );
    }
  });

  it('treats an empty body as {} only where the endpoint allows it', async () => {
    await expect(readJsonObjectOrEmpty(jsonRequest(''))).resolves.toEqual({});
    await expect(readJsonObjectOrEmpty(jsonRequest('   '))).resolves.toEqual(
      {},
    );
    await expect(
      readJsonObjectOrEmpty(jsonRequest('nonsense')),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('requires a non-empty, bounded string', () => {
    expect(requiredString({ a: 'x' }, 'a')).toBe('x');
    expect(() => requiredString({}, 'a')).toThrow(BadRequestError);
    expect(() => requiredString({ a: '  ' }, 'a')).toThrow(BadRequestError);
    expect(() => requiredString({ a: 7 }, 'a')).toThrow(BadRequestError);
    expect(() => requiredString({ a: 'toolong' }, 'a', 3)).toThrow(
      BadRequestError,
    );
  });

  it('bounds an optional number and refuses a non-number', () => {
    const bounds = { min: 1, max: 10 };
    expect(optionalNumber({}, 'n', bounds)).toBeUndefined();
    expect(optionalNumber({ n: null }, 'n', bounds)).toBeUndefined();
    expect(optionalNumber({ n: 5 }, 'n', bounds)).toBe(5);
    expect(() => optionalNumber({ n: 0 }, 'n', bounds)).toThrow(
      BadRequestError,
    );
    expect(() => optionalNumber({ n: 11 }, 'n', bounds)).toThrow(
      BadRequestError,
    );
    expect(() => optionalNumber({ n: '5' }, 'n', bounds)).toThrow(
      BadRequestError,
    );
    expect(() => optionalNumber({ n: Number.NaN }, 'n', bounds)).toThrow(
      BadRequestError,
    );
  });

  it('refuses a value outside a closed set', () => {
    const allowed = ['mock', 'live'] as const;
    expect(optionalEnum({ mode: 'live' }, 'mode', allowed)).toBe('live');
    expect(optionalEnum({}, 'mode', allowed)).toBeUndefined();
    expect(() => optionalEnum({ mode: 'dry' }, 'mode', allowed)).toThrow(
      BadRequestError,
    );
  });

  it('refuses a non-boolean', () => {
    expect(optionalBoolean({ b: true }, 'b')).toBe(true);
    expect(optionalBoolean({}, 'b')).toBeUndefined();
    expect(() => optionalBoolean({ b: 'true' }, 'b')).toThrow(BadRequestError);
  });

  it('keeps null distinct from absent for a binding list', () => {
    expect(optionalStringArrayOrNull({}, 'tools')).toBeUndefined();
    expect(optionalStringArrayOrNull({ tools: null }, 'tools')).toBeNull();
    expect(optionalStringArrayOrNull({ tools: [] }, 'tools')).toEqual([]);
    expect(optionalStringArrayOrNull({ tools: ['a'] }, 'tools')).toEqual(['a']);
    expect(() => optionalStringArrayOrNull({ tools: [1] }, 'tools')).toThrow(
      BadRequestError,
    );
    expect(() =>
      optionalStringArrayOrNull({ tools: ['a', 'b'] }, 'tools', 1),
    ).toThrow(BadRequestError);
    // The plain reader collapses null into absent — for fields where "remove
    // the narrowing" is not a thing.
    expect(optionalStringArray({ labels: null }, 'labels')).toBeUndefined();
  });
});

/**
 * Regression for #2317: a successful REST api-key authentication must stamp the
 * key's `lastRequest`, otherwise the Settings → API table forever reads
 * "Never used". Better Auth's own session-hook write is a no-op in this HTTP
 * action context, so the helper writes the field directly on the component row.
 */
describe('authenticateRequest — records api-key last-used (#2317)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stamps lastRequest on the authenticated api-key row', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user_1', email: 'a@b.com', name: 'A' },
      session: { id: 'apikey_123' },
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);

    const user = await authenticateRequest(
      ctxWith(runMutation),
      bearerRequest('tale_secret'),
    );

    expect(user).toEqual({ userId: 'user_1', email: 'a@b.com', name: 'A' });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, args] = runMutation.mock.calls[0];
    expect(args.input.model).toBe('apikey');
    expect(args.input.where).toEqual([
      { field: '_id', value: 'apikey_123', operator: 'eq' },
    ]);
    expect(typeof args.input.update.lastRequest).toBe('number');
  });

  it('still authenticates when the last-used stamp fails (best-effort)', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user_1', email: 'a@b.com', name: 'A' },
      session: { id: 'apikey_123' },
    });
    const runMutation = vi.fn().mockRejectedValue(new Error('write blocked'));

    const user = await authenticateRequest(
      ctxWith(runMutation),
      bearerRequest('tale_secret'),
    );

    expect(user.userId).toBe('user_1');
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid key and never stamps', async () => {
    getSession.mockResolvedValue(null);
    const runMutation = vi.fn();

    await expect(
      authenticateRequest(ctxWith(runMutation), bearerRequest('tale_bad')),
    ).rejects.toThrow('Invalid API key or session');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('rejects a request without a Bearer token', async () => {
    const runMutation = vi.fn();
    const request = new Request('https://app.example.com/api/v1/agents');

    await expect(
      authenticateRequest(ctxWith(runMutation), request),
    ).rejects.toThrow('Missing or invalid Authorization header');
    expect(runMutation).not.toHaveBeenCalled();
  });
});
