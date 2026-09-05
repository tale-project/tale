// @vitest-environment node

import Ajv from 'ajv';
import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../backend/auth/auth.ts';
import type { RestEnv } from '../../backend/rest/shared.ts';
import { createAutomationRestRoutes } from '../../backend/rest/v1-automations.ts';
import { createCoreRoutes } from '../../backend/rest/v1-core.ts';
import { createProjectRestRoutes } from '../../backend/rest/v1-projects.ts';
import { createThreadRestRoutes } from '../../backend/rest/v1-threads.ts';
import { createRestV1Routes } from '../../backend/rest/v1.ts';
import { buildSpec, type Json } from './spec.ts';

/**
 * The drift guard between `/docs` and the code it describes — the successor
 * of the retired convex-era `openapi_spec.test.ts`. Two directions:
 *
 * 1. Every `/api/v1` path+method the spec documents is a registered route,
 *    and every registered route is documented.
 * 2. What the handlers actually answer validates against the spec's 200
 *    schema — run over scripted rows, so a spec that declares an envelope
 *    a handler does not produce (the `{data, cursor, hasMore}` and
 *    `{page, …}`-for-a-named-array drift this test was born from) fails.
 */

vi.mock('../../backend/auth/auth.ts', () => ({
  API_KEY_RATE_LIMIT: { enabled: true, timeWindow: 60_000, maxRequests: 100 },
  loadTrustedProxies: () => Promise.resolve(['loopback', 'uniquelocal']),
}));
// The upload handoff presigns against the org's bucket; the wire shape is
// what is under test here, so the presign is scripted.
vi.mock('../../backend/domains/files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../backend/domains/files/service.ts')
  >()),
  createRestUploadHandoff: () =>
    Promise.resolve({
      uploadUrl: 'https://blobs.example.com/acme/blob-1?signed',
      storageRef: 'acme/blob-1',
    }),
}));

const spec = buildSpec();
const paths = spec.paths as Record<string, Record<string, Json>>;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** `/automations/:name{.+}/runs` → `/api/v1/automations/{name}/runs`. */
function openapiPath(honoPath: string): string {
  return `/api/v1${honoPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?/g, '{$1}')}`;
}

/** Routes the router registers that the spec deliberately leaves out. */
const UNDOCUMENTED_ROUTES = new Set([
  // A 405 stub so a browser hitting the MCP URL learns it is POST-only.
  'GET /api/v1/mcp',
]);

describe('openapi spec ↔ /api/v1 router', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- construction never touches either dependency
  const router = createRestV1Routes({ sql: {} as Sql, auth: {} as Auth });
  const registered = new Set(
    router.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${openapiPath(route.path)}`),
  );
  const documented = new Set(
    Object.entries(paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((method) => HTTP_METHODS.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    ),
  );

  it('documents only registered /api/v1 routes (plus the app-level webhook)', () => {
    const outsideV1 = [...documented].filter((op) => !op.includes(' /api/v1/'));
    expect(outsideV1).toEqual(['POST /api/automations/webhook/{token}']);
    const phantom = [...documented].filter(
      (op) => op.includes(' /api/v1/') && !registered.has(op),
    );
    expect(phantom).toEqual([]);
  });

  it('registers no /api/v1 route the spec leaves out', () => {
    const missing = [...registered].filter(
      (op) => !documented.has(op) && !UNDOCUMENTED_ROUTES.has(op),
    );
    expect(missing).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = Object.values(paths).flatMap((ops) =>
      Object.entries(ops)
        .filter(([method]) => HTTP_METHODS.has(method))
        .map(([, op]) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Response-shape parity ────────────────────────────────────────────────────

const ajv = new Ajv({ strict: false, allErrors: true });

/** A validator for the spec's `<status>` JSON response of `<method> <path>`. */
function responseValidator(path: string, method: string, status: string) {
  const op = paths[path]?.[method];
  const responses = op?.responses as Record<string, Json> | undefined;
  const content = responses?.[status]?.content as
    | Record<string, Json>
    | undefined;
  const schema = content?.['application/json']?.schema as Json | undefined;
  if (!schema)
    throw new Error(`${method} ${path} ${status} has no JSON schema`);
  return ajv.compile({ ...schema, components: spec.components });
}

/** Tagged-template Sql double answering every query with `rows`; an
 * optional `respond` answers a query by its text first. `begin` runs the
 * callback on the same tag. */
function fakeSql(
  rows: object[],
  respond?: (text: string) => object[] | undefined,
): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    return Promise.resolve(respond?.(text) ?? rows);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

function mount(routes: Hono<RestEnv>) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    // Named, as the write-shaped families (projects, tasks) require.
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', routes);
  return app;
}

const contact = {
  id: 'c-1',
  organizationId: 'org-1',
  name: 'Ada',
  email: 'ada@example.com',
  phone: null,
  externalId: null,
  source: 'manual',
  locale: null,
  address: null,
  tags: ['vip'],
  metadata: null,
  notes: null,
  lifecycleStatus: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

const product = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Widget',
  description: null,
  imageUrl: null,
  stock: 3,
  price: 9.5,
  currency: 'EUR',
  category: null,
  tags: [],
  status: 'active',
  translations: null,
  externalId: null,
  metadata: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

const entry = {
  id: 'k-1',
  topic: 'Refunds',
  content: 'Refunds settle in 14 days.',
  status: 'active',
  source: 'manual',
  documentId: null,
  supersededBy: null,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  seq: 7,
};

const automation = {
  name: 'billing/dunning',
  latestVersion: 3,
  deployedVersion: 2,
  presentation: null,
};

const run = {
  id: 'run-1',
  organizationId: 'org-1',
  name: 'billing/dunning',
  version: 2,
  projectId: null,
  status: 'success',
  mode: 'live',
  startedBy: 'api-key:user-1',
  input: { n: 1 },
  output: 2,
  checkpoints: {},
  trace: [],
  effects: [],
  detail: null,
  claimEpoch: 1,
  chainSeq: 0,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_000_500,
};

describe('handler responses validate against the spec', () => {
  const cases: {
    name: string;
    routes: () => Hono<RestEnv>;
    rows: object[];
    request: string;
    spec: [path: string, method: string, status: string];
  }[] = [
    {
      name: 'GET /contacts',
      routes: () => createCoreRoutes({ sql: fakeSql([contact, contact]) }),
      rows: [contact],
      request: '/contacts?limit=1',
      spec: ['/api/v1/contacts', 'get', '200'],
    },
    {
      name: 'GET /contacts/{id}',
      routes: () => createCoreRoutes({ sql: fakeSql([contact]) }),
      rows: [contact],
      request: '/contacts/c-1',
      spec: ['/api/v1/contacts/{id}', 'get', '200'],
    },
    {
      name: 'GET /products',
      routes: () => createCoreRoutes({ sql: fakeSql([product]) }),
      rows: [product],
      request: '/products',
      spec: ['/api/v1/products', 'get', '200'],
    },
    {
      name: 'GET /products/{id}',
      routes: () => createCoreRoutes({ sql: fakeSql([product]) }),
      rows: [product],
      request: '/products/p-1',
      spec: ['/api/v1/products/{id}', 'get', '200'],
    },
    {
      name: 'GET /knowledge-entries',
      routes: () => createCoreRoutes({ sql: fakeSql([entry, entry]) }),
      rows: [entry],
      request: '/knowledge-entries?limit=1',
      spec: ['/api/v1/knowledge-entries', 'get', '200'],
    },
    {
      name: 'GET /knowledge-entries/{id}',
      routes: () => createCoreRoutes({ sql: fakeSql([entry]) }),
      rows: [entry],
      request: '/knowledge-entries/k-1',
      spec: ['/api/v1/knowledge-entries/{id}', 'get', '200'],
    },
    {
      name: 'GET /automations',
      routes: () => createAutomationRestRoutes({ sql: fakeSql([automation]) }),
      rows: [automation],
      request: '/automations',
      spec: ['/api/v1/automations', 'get', '200'],
    },
    {
      name: 'GET /automations/{name}/runs',
      routes: () => createAutomationRestRoutes({ sql: fakeSql([run]) }),
      rows: [run],
      request: '/automations/billing__dunning/runs?limit=1',
      spec: ['/api/v1/automations/{name}/runs', 'get', '200'],
    },
    {
      name: 'GET /runs/{runId}',
      routes: () => createAutomationRestRoutes({ sql: fakeSql([run]) }),
      rows: [run],
      request: '/runs/run-1',
      spec: ['/api/v1/runs/{runId}', 'get', '200'],
    },
  ];

  it.each(cases)(
    '$name',
    async ({ routes, request, spec: [path, method, status] }) => {
      const res = await mount(routes()).request(`http://localhost${request}`);
      expect(res.status).toBe(Number(status));
      const body: unknown = await res.json();
      const validate = responseValidator(path, method, status);
      const ok = validate(body);
      expect(
        ok,
        JSON.stringify({ errors: validate.errors, body }, null, 2),
      ).toBe(true);
    },
  );
});

// ── Status + shape parity for the operations whose prose once drifted ───────

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archivedAt: null,
};

const thread = {
  id: 't-1',
  title: 'Refunds',
  kind: 'direct',
  agentSlug: null,
  harness: null,
  projectId: null,
  archived: false,
  isShared: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

/** The response keys the spec documents for `<method> <path>`. */
function documentedStatuses(path: string, method: string): string[] {
  const op = paths[path]?.[method];
  const responses = op?.responses as Record<string, Json> | undefined;
  return Object.keys(responses ?? {}).sort();
}

/**
 * The spec's field- and status-level claims the path/verb parity above
 * cannot see: each case drives the real handler and checks both that the
 * status is documented and that a JSON body validates. Born from the drift
 * where the upload handoff documented a `POST`/`storageId` lane and the
 * generation poll documented `waiting-*` states neither route ever answered.
 */
describe('handler statuses and bodies match the documented operation', () => {
  const projectSql = fakeSql([], (text) => {
    if (text.includes('FROM "teamMember"')) return [];
    if (text.includes('FROM app.projects WHERE id')) return [project];
    if (text.includes('INSERT INTO app.rate_limits')) return [{ value: '1' }];
    return [];
  });

  it('POST /projects/{id}/uploads answers the one PUT lane the schema names', async () => {
    const res = await mount(
      createProjectRestRoutes({ sql: projectSql }),
    ).request('http://localhost/projects/p-1/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'ledger.pdf' }),
    });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const validate = responseValidator(
      '/api/v1/projects/{id}/uploads',
      'post',
      '200',
    );
    expect(
      validate(body),
      JSON.stringify({ errors: validate.errors, body }),
    ).toBe(true);
    expect(body).toMatchObject({ method: 'PUT', s3Ref: 'acme/blob-1' });
  });

  it('GET /threads/{id}/generation answers only the states the enum names', async () => {
    const sql = fakeSql([], (text) => {
      if (text.includes('FROM app.threads t')) return [thread];
      if (text.includes('FROM app.generations')) return [{ messageId: 'm-9' }];
      return [];
    });
    const res = await mount(createThreadRestRoutes({ sql })).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const validate = responseValidator(
      '/api/v1/threads/{id}/generation',
      'get',
      '200',
    );
    expect(
      validate(body),
      JSON.stringify({ errors: validate.errors, body }),
    ).toBe(true);
    expect(body).toEqual({ status: 'streaming', messageId: 'm-9' });
  });

  it('POST /projects/{id}/files documents the 409 the intent refusal throws', async () => {
    const res = await mount(
      createProjectRestRoutes({ sql: projectSql }),
    ).request('http://localhost/projects/p-1/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'u-unknown',
        fileId: 'acme/blob-1',
        folderId: 'fold-1',
        fileName: 'ledger.pdf',
      }),
    });
    expect(res.status).toBe(409);
    expect(documentedStatuses('/api/v1/projects/{id}/files', 'post')).toContain(
      '409',
    );
  });

  it('DELETE /agents/{slug} documents 204 and 404, not a {deleted} 200', () => {
    // The route itself is pinned in rest/v1-core.test.ts (204, then 404).
    const statuses = documentedStatuses('/api/v1/agents/{slug}', 'delete');
    expect(statuses).toContain('204');
    expect(statuses).toContain('404');
    expect(statuses).not.toContain('200');
  });
});
