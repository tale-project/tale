import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  argsOf,
  jsonBody,
  restCtx,
  restRequest,
  TEST_USER_ID,
  testSession,
} from './handler_kit.testkit';
import type { HttpCtx } from './helpers';
import {
  authenticateRequest,
  BadRequestError,
  httpStatusForConvexCode,
  jsonOk,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalStringArray,
  optionalStringArrayOrNull,
  parsePageLimit,
  readJsonObject,
  readJsonObjectOrEmpty,
  requiredString,
  REST_CORS_HEADERS,
  withRestAuth,
} from './helpers';

// `authenticateRequest` resolves identity through Better Auth; stub `createAuth`
// so the tests drive the session result directly without the real auth stack.
const getSession = vi.fn();
vi.mock('../../auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession } })),
}));

// The `withRestAuth` tests drive the wrapper directly (see
// handler_kit.testkit.ts): `httpAction` becomes the identity function and the
// IP limiter always admits.
vi.mock('../../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));
vi.mock('../rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
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
 * The REST wrapper (`withRestAuth`) maps typed `AppError` codes to HTTP
 * statuses via `httpStatusForConvexCode`; any code resolving to a 4xx is
 * forwarded to the client, everything else falls through to a generic 500.
 *
 * `validateProductFields` throws `AppError({ code: 'too_long' })` on the
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
    // A project binding must point at a real automation.
    ['AUTOMATION_NOT_FOUND', 404],
    // A create against a name that already has versions.
    ['AUTOMATION_NAME_TAKEN', 409],
    // A run named a real project the automation is not bound to (bad argument,
    // distinct from PROJECT_NOT_FOUND's "no such project").
    ['PROJECT_NOT_BOUND', 400],
    // Capability and membership refusals
    ['FORBIDDEN_DEVELOPER_SETTINGS', 403],
    ['ORG_FORBIDDEN', 403],
    ['ORG_NOT_FOUND', 404],
    // An empty organizationId at a membership gate (bad argument, distinct
    // from ORG_NOT_FOUND's 404).
    ['ORG_ID_REQUIRED', 400],
    // Org resolution at the REST boundary (resolve_user_organization).
    ['ORG_SLUG_REQUIRED', 400],
    ['ORG_SLUG_INVALID', 400],
    // An explicit project key failing the 2-6 char shape.
    ['PROJECT_KEY_INVALID', 400],
    // A blank/over-length task comment body (transport pre-guards; the row
    // keeps a future cap divergence a 400).
    ['TASK_COMMENT_INVALID', 400],
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
   * The machine-door groundwork: codes the /api/v1/projects and /api/v1/tasks
   * endpoints (and the shared upload lane) surface. All exist in the codebase
   * today except PROJECT_DUPLICATE_EXTERNAL_ID, declared ahead of its producer
   * in projects/mutations.ts.
   */
  it.each([
    ['RBAC_FORBIDDEN', 403],
    ['LEGAL_HOLD_ACTIVE', 403],
    // Projects
    ['PROJECT_KEY_TAKEN', 409],
    ['PROJECT_DUPLICATE_EXTERNAL_ID', 409],
    ['PROJECT_NAME_INVALID', 400],
    // Folders and document scoping
    ['FOLDER_DUPLICATE_NAME', 409],
    ['FOLDER_SCOPE_CONFLICT', 400],
    ['DOCUMENT_SCOPE_CONFLICT', 409],
    // Tasks
    ['TASK_NOT_FOUND', 404],
    ['TASK_COMMENT_NOT_FOUND', 404],
    ['TASK_ATTACHMENT_NOT_FOUND', 404],
    ['SETUP_FOLDER_MISSING', 409],
    ['INVALID_ARGUMENTS', 400],
    // Label validation inside the create-task upsert (labels passthrough).
    ['TASK_LABELS_INVALID', 400],
    // Rate limiting and upload validation
    ['RATE_LIMITED', 429],
    ['FILE_TOO_LARGE', 413],
    ['UNSUPPORTED_FILE_TYPE', 415],
    ['UPLOAD_POLICY_REJECTED', 400],
    ['UPLOAD_BLOB_INVALID', 400],
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

describe('REST_CORS_HEADERS', () => {
  it('lets a browser preflight send X-Organization-Slug', () => {
    const allowHeaders = REST_CORS_HEADERS['Access-Control-Allow-Headers'];
    expect(allowHeaders).toContain('Authorization');
    expect(allowHeaders).toContain('X-Organization-Slug');
  });
});

const RESOLVE_ORG =
  'organizations/resolve_user_organization:resolveUserOrganization';

type Invoke = (ctx: HttpCtx, request: Request) => Promise<Response>;

/**
 * Org-resolution plumbing in `withRestAuth`: the `X-Organization-Slug` header
 * flows into the resolver on every route, `requireExplicitOrgSlug` flows
 * per-route, and a resolver refusal surfaces through the coded-error map —
 * ORG_FORBIDDEN → 403 for a non-member slug, ORG_SLUG_REQUIRED → 400 for an
 * undecidable multi-org key — while an uncoded failure stays a 400 with the
 * Convex stack wrapper stripped from the body. The resolver's own branching is
 * pinned in organizations/resolve_user_organization.test.ts.
 */
describe('withRestAuth — organization resolution plumbing', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function asInvoke(wrapped: unknown): Invoke {
    return wrapped as Invoke;
  }

  it('feeds the X-Organization-Slug header into the resolver', async () => {
    getSession.mockResolvedValue(testSession());
    const { ctx, calls } = restCtx({
      [RESOLVE_ORG]: () => ({
        organizationId: 'org_two',
        orgSlug: 'acme-two',
      }),
    });
    const handler = asInvoke(
      withRestAuth('rest:api', async (rc) => jsonOk({ slug: rc.org.orgSlug })),
    );

    const response = await handler(
      ctx,
      restRequest('/api/v1/projects', {
        headers: { 'X-Organization-Slug': 'acme-two' },
      }),
    );

    expect(response.status).toBe(200);
    await expect(jsonBody(response)).resolves.toEqual({ slug: 'acme-two' });
    expect(argsOf(calls, RESOLVE_ORG)).toMatchObject({
      userId: TEST_USER_ID,
      orgSlug: 'acme-two',
    });
  });

  it('surfaces the membership refusal for a non-member slug as coded 403', async () => {
    getSession.mockResolvedValue(testSession());
    const { ctx } = restCtx({
      [RESOLVE_ORG]: () => {
        throw new AppError({
          code: 'ORG_FORBIDDEN',
          message: 'Not a member of organization acme-two',
        });
      },
    });
    const handler = asInvoke(withRestAuth('rest:api', async () => jsonOk({})));

    const response = await handler(
      ctx,
      restRequest('/api/v1/projects', {
        headers: { 'X-Organization-Slug': 'acme-two' },
      }),
    );

    expect(response.status).toBe(403);
    await expect(jsonBody(response)).resolves.toEqual({
      error: 'Not a member of organization acme-two',
    });
  });

  it('answers a fixed 500 for uncoded resolver failures — no Convex prelude leaks', async () => {
    getSession.mockResolvedValue(testSession());
    const { ctx } = restCtx({
      [RESOLVE_ORG]: () => {
        throw new Error(
          '[CONVEX Q(organizations/resolve_user_organization:resolveUserOrganization)] [Request ID: abc123] Server Error\nUncaught Error: backing store exploded\n    at handler (../../convex/organizations/resolve_user_organization.ts:128:10)',
        );
      },
    });
    const handler = asInvoke(withRestAuth('rest:api', async () => jsonOk({})));

    const response = await handler(ctx, restRequest('/api/v1/projects'));

    expect(response.status).toBe(500);
    await expect(jsonBody(response)).resolves.toEqual({
      error: 'Failed to resolve organization',
    });
  });

  it('forwards requireExplicitOrgSlug and answers 400 naming the header', async () => {
    getSession.mockResolvedValue(testSession());
    const { ctx, calls } = restCtx({
      [RESOLVE_ORG]: () => {
        throw new AppError({
          code: 'ORG_SLUG_REQUIRED',
          message:
            'User belongs to multiple organizations. Provide X-Organization-Slug header.',
        });
      },
    });
    const handler = asInvoke(
      withRestAuth('rest:api', async () => jsonOk({}), {
        requireExplicitOrgSlug: true,
      }),
    );

    const response = await handler(ctx, restRequest('/api/v1/projects'));

    expect(response.status).toBe(400);
    const body = await jsonBody(response);
    expect(body.error).toContain('X-Organization-Slug');
    expect(argsOf(calls, RESOLVE_ORG)).toMatchObject({
      requireExplicitOrgSlug: true,
    });
  });

  it('keeps legacy auto-resolution when no header and no flag are given', async () => {
    getSession.mockResolvedValue(testSession());
    const { ctx, calls } = restCtx();
    const handler = asInvoke(withRestAuth('rest:api', async () => jsonOk({})));

    const response = await handler(ctx, restRequest('/api/v1/projects'));

    expect(response.status).toBe(200);
    const args = argsOf(calls, RESOLVE_ORG);
    expect(args?.orgSlug).toBeUndefined();
    expect(args?.requireExplicitOrgSlug).toBeUndefined();
  });

  it.each([
    // Nested shape (projects/tasks mapRateLimitError)...
    [{ code: 'RATE_LIMITED', data: { retryAfterMs: 30_500 } }, '31'],
    // ...and flat shape (documents/validate_upload).
    [
      { code: 'RATE_LIMITED', message: 'upload limit', retryAfterMs: 1200 },
      '2',
    ],
  ])(
    'answers 429 with Retry-After when a backing function throws RATE_LIMITED',
    async (payload, retryAfter) => {
      getSession.mockResolvedValue(testSession());
      const { ctx } = restCtx();
      const handler = asInvoke(
        withRestAuth('rest:api', async () => {
          throw new AppError(payload);
        }),
      );

      const response = await handler(ctx, restRequest('/api/v1/projects'));

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe(retryAfter);
    },
  );
});
