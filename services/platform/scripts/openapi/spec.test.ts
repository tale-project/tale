// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';

import Ajv from 'ajv';
import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../backend/auth/auth.ts';
import { handleMcpRequest } from '../../backend/core/automations_builder/mcp_http.ts';
import type {
  SkillDocumentView,
  SkillSummaryView,
} from '../../backend/core/skills/views.ts';
import { createWebhookRoutes } from '../../backend/domains/automations/triggers.ts';
import { API_CONTACT_STATUSES } from '../../backend/domains/conversations/api-sync.ts';
import { PLATFORM_CAPABILITIES } from '../../backend/domains/governance/competence.ts';
import { PRODUCT_STATUSES } from '../../backend/domains/products/service.ts';
import { describeByteCap } from '../../backend/lib/byte-cap.ts';
import { REST_ERROR_CODES } from '../../backend/rest/error-codes.ts';
import type { RestEnv } from '../../backend/rest/shared.ts';
import { createAutomationRestRoutes } from '../../backend/rest/v1-automations.ts';
import { createRestBrowserSessionRoutes } from '../../backend/rest/v1-browser-sessions.ts';
import { createCoreRoutes } from '../../backend/rest/v1-core.ts';
import { createProjectRestRoutes } from '../../backend/rest/v1-projects.ts';
import { createTaskRestRoutes } from '../../backend/rest/v1-tasks.ts';
import { createThreadRestRoutes } from '../../backend/rest/v1-threads.ts';
import { createRestWebsiteRoutes } from '../../backend/rest/v1-websites.ts';
import { createRestV1Routes } from '../../backend/rest/v1.ts';
import { contractFingerprint } from './fingerprint.ts';
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
function openapiPath(honoPath: string, prefix = '/api/v1'): string {
  return `${prefix}${honoPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?/g, '{$1}')}`;
}

/** Routes the router registers that the spec deliberately leaves out —
 * none today: the MCP URL's other verbs are the door's own 405 (`Allow:
 * POST`), not registrations of their own. */
const UNDOCUMENTED_ROUTES = new Set<string>([]);

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

  it('documents only registered /api/v1 routes and the app-level webhooks', () => {
    const outsideV1 = [...documented].filter((op) => !op.includes(' /api/v1/'));
    expect(outsideV1.sort()).toEqual([
      'POST /api/automations/webhook/{token}',
      'POST /api/projects/{id}/automations/webhook/{token}',
    ]);
    // Use the app's literal mount points and the child router's registered
    // operations without constructing every session route or telemetry.
    const appSource = readFileSync(
      new URL('../../backend/app.ts', import.meta.url),
      'utf8',
    );
    const mounts = [
      ...appSource.matchAll(
        /app\.route\(\s*['"]([^'"]+)['"],\s*createWebhookRoutes\(/g,
      ),
    ].map((match) => match[1]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route registration never queries the database
    const webhooks = createWebhookRoutes({
      sql: {} as Sql,
      trustedProxies: () => Promise.resolve([]),
    });
    const registeredWebhooks = mounts.flatMap((base) =>
      webhooks.routes
        .filter((route) => route.method !== 'ALL')
        .map(
          (route) =>
            `${route.method} ${openapiPath(`${base}${route.path}`, '')}`,
        ),
    );
    expect(outsideV1.sort()).toEqual(registeredWebhooks.sort());
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

  it('publishes the current schema in public/openapi.json', () => {
    const published: unknown = JSON.parse(
      readFileSync(
        new URL('../../public/openapi.json', import.meta.url),
        'utf8',
      ),
    );
    expect(published).toEqual(spec);
  });

  it('documents the tenant header on every /api/v1 operation', () => {
    const missing = Object.entries(paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(
          ([method]) => HTTP_METHODS.has(method) && path.startsWith('/api/v1/'),
        )
        .filter(([, op]) => {
          const parameters = (op.parameters ?? []) as Json[];
          return !parameters.some(
            (parameter) =>
              parameter.in === 'header' &&
              parameter.name === 'X-Organization-Slug',
          );
        })
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(missing).toEqual([]);
  });

  it('names the deployment origin as a server template a running instance fills in', () => {
    expect(spec.servers).toEqual([
      expect.objectContaining({
        url: '{origin}',
        variables: {
          origin: expect.objectContaining({ default: expect.any(String) }),
        },
      }),
    ]);
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
  const begin = (
    optionsOrCallback: string | ((tx: unknown) => Promise<unknown>),
    callback?: (tx: unknown) => Promise<unknown>,
  ) => {
    const run =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (run === undefined) throw new Error('Missing transaction callback');
    return run(sql);
  };
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

const browserSession = {
  id: 'bs-1',
  domain: 'youtube.com',
  label: 'Session A',
  status: 'healthy',
  createdAt: 1_699_000_000_000,
  expiresAt: 1_700_000_000_000,
  lastUsedAt: null,
  failureCount: 0,
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
      // `capabilities` admits no undeclared key, so a gate the handler
      // answers and the schema does not name fails here.
      name: 'GET /me',
      routes: () =>
        createCoreRoutes({
          sql: fakeSql(
            [
              {
                organizationId: 'org-1',
                role: 'admin',
                name: 'Acme',
                slug: 'acme',
              },
            ],
            (text) =>
              text.includes('FROM "apikey"')
                ? [{ id: 'key-1', name: 'Billing sync', expiresAt: null }]
                : undefined,
          ),
        }),
      rows: [],
      request: '/me',
      spec: ['/api/v1/me', 'get', '200'],
    },
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
      name: 'GET /browser-sessions',
      routes: () =>
        createRestBrowserSessionRoutes({ sql: fakeSql([browserSession]) }),
      rows: [browserSession],
      request: '/browser-sessions',
      spec: ['/api/v1/browser-sessions', 'get', '200'],
    },
    {
      name: 'GET /automations',
      // The catalog filters bindings through the caller's visible projects,
      // so the project listing must answer with project rows — never the
      // automation row, which the listing would stamp access flags onto.
      routes: () =>
        createAutomationRestRoutes({
          sql: fakeSql([automation], (text) =>
            text.includes('FROM app.projects')
              ? [
                  {
                    id: 'p-1',
                    organizationId: 'org-1',
                    teamId: null,
                    sharedWithTeamIds: [],
                    archivedAt: null,
                  },
                ]
              : text.includes('FROM app.automation_project_bindings') ||
                  text.includes('FROM app.automation_triggers')
                ? []
                : undefined,
          ),
        }),
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
    {
      // A projected read answers only the keys named — the `RunProjection`
      // half of the declared `anyOf`, since `Run` requires keys it omits.
      name: 'GET /runs/{runId}?fields=',
      routes: () => createAutomationRestRoutes({ sql: fakeSql([run]) }),
      rows: [run],
      request: '/runs/run-1?fields=status,finishedAt',
      spec: ['/api/v1/runs/{runId}', 'get', '200'],
    },
    {
      name: 'GET /runs',
      // The all-runs listing filters by the caller's visible projects, so
      // the project query must answer project rows.
      routes: () =>
        createAutomationRestRoutes({
          sql: fakeSql([run], (text) =>
            text.includes('FROM app.projects')
              ? [
                  {
                    id: 'p-1',
                    organizationId: 'org-1',
                    teamId: null,
                    sharedWithTeamIds: [],
                    archivedAt: null,
                  },
                ]
              : undefined,
          ),
        }),
      rows: [run],
      request: '/runs?include=input,output&status=success',
      spec: ['/api/v1/runs', 'get', '200'],
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
  teamIds: [],
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
    expect(body).toEqual({
      status: 'streaming',
      messageId: 'm-9',
      text: '',
      textOffset: 0,
      textLength: 0,
      reasoning: '',
      reasoningOffset: 0,
      reasoningLength: 0,
      cancelRequested: false,
    });
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

  it.each([
    [
      '/projects',
      '/api/v1/projects',
      { projects: [project], isDone: true, continueCursor: '' },
    ],
    // A lookup is one whole page and says so in the list's own words.
    [
      '/projects?externalItemId=crm-4711',
      '/api/v1/projects',
      { projects: [project], isDone: true, continueCursor: '' },
    ],
    ['/projects?archived=only&limit=1', '/api/v1/projects', null],
  ])(
    'GET %s answers the published list-or-lookup envelope',
    async (route, specPath, expected) => {
      const sql = fakeSql([], (text) => {
        if (text.includes('FROM "teamMember"')) return [];
        if (text.includes('FROM app.projects')) return [project];
        return [];
      });
      const res = await mount(createProjectRestRoutes({ sql })).request(
        `http://localhost${route}`,
      );
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      const validate = responseValidator(specPath, 'get', '200');
      expect(
        validate(body),
        JSON.stringify({ errors: validate.errors, body }),
      ).toBe(true);
      if (expected !== null) {
        expect(body).toEqual({
          ...expected,
          projects: [
            expect.objectContaining({
              id: 'p-1',
              name: 'Ledger',
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
            }),
          ],
        });
      }
    },
  );

  it('PATCH /projects/{id} answers the project it documents; DELETE documents 204 and its 409s', async () => {
    const sql = fakeSql([], (text) => {
      if (text.includes('FROM "teamMember"')) return [];
      if (text.includes('FROM app.projects')) return [project];
      return [];
    });
    const res = await mount(createProjectRestRoutes({ sql })).request(
      'http://localhost/projects/p-1',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      },
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const validate = responseValidator('/api/v1/projects/{id}', 'patch', '200');
    expect(
      validate(body),
      JSON.stringify({ errors: validate.errors, body }),
    ).toBe(true);
    const statuses = documentedStatuses('/api/v1/projects/{id}', 'delete');
    expect(statuses).toContain('204');
    expect(statuses).toContain('403');
    expect(statuses).toContain('409');
    expect(statuses).not.toContain('200');
  });

  it('DELETE /projects/{id}/agents/{agentId} documents 204 and 404, not a {deleted} 200', () => {
    // The real Postgres lifecycle is pinned in rest/project-agents-check.ts.
    const statuses = documentedStatuses(
      '/api/v1/projects/{id}/agents/{agentId}',
      'delete',
    );
    expect(statuses).toContain('204');
    expect(statuses).toContain('404');
    expect(statuses).not.toContain('200');
  });

  /** A 204 documented what the handler no longer answers: the website
   * patch returns the row, like the contact, product and document patch. */
  it('PATCH /websites/{id} answers the website it documents, not a 204', async () => {
    const website = {
      id: 'w-1',
      organizationId: 'org-1',
      domain: 'docs.example',
      kind: 'site',
      title: 'Docs',
      description: null,
      scanInterval: '1d',
      lastScannedAt: null,
      status: 'active',
      pageCount: 3,
      crawledPageCount: 3,
      metadata: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
    };
    const res = await mount(
      createRestWebsiteRoutes({ sql: fakeSql([website]) }),
    ).request('http://localhost/websites/w-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Docs', domain: 'docs.example' }),
    });
    expect(res.status).toBe(200);
    const statuses = documentedStatuses('/api/v1/websites/{id}', 'patch');
    expect(statuses).toContain('200');
    expect(statuses).not.toContain('204');
    const body: unknown = await res.json();
    const validate = responseValidator('/api/v1/websites/{id}', 'patch', '200');
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    expect(body).toMatchObject({ id: 'w-1', domain: 'docs.example' });
  });

  it.each([
    ['/projects/p-1/agents', '/api/v1/projects/{id}/agents'],
    ['/projects/p-1/agents/a-1', '/api/v1/projects/{id}/agents/{agentId}'],
  ])(
    '%s returns project-agent records matching the published schema',
    async (route, specPath) => {
      const agent = {
        id: 'a-1',
        organizationId: 'org-1',
        projectId: 'p-1',
        name: 'Reviewer',
        harness: 'claude-code',
        model: 'test-model',
        modelProvider: null,
        instructions: null,
        skills: [],
        connectors: [],
        tools: [],
        secrets: [],
        createdBy: 'user-1',
        createdAt: 1,
        updatedAt: 2,
      };
      const sql = fakeSql([], (text) => {
        if (text.includes('FROM app.projects WHERE id')) return [project];
        if (text.includes('FROM app.project_agents')) return [agent];
        return [];
      });
      const response = await mount(createProjectRestRoutes({ sql })).request(
        `http://localhost${route}`,
      );
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      const validate = responseValidator(specPath, 'get', '200');
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
      expect(body).toEqual(
        route.endsWith('/a-1') ? { agent } : { agents: [agent] },
      );
    },
  );
});

/** Scope is contractual input: a client must not be told to send a JSON
 * selector that the route refuses or ignores. */
describe('project scope in OpenAPI inputs', () => {
  function validateBody(path: string, method: string, body: unknown) {
    const request = paths[path]?.[method]?.requestBody as Json | undefined;
    const content = request?.content as Record<string, Json> | undefined;
    const schema = content?.['application/json']?.schema as Json | undefined;
    expect(
      schema,
      `${method.toUpperCase()} ${path} request schema`,
    ).toBeDefined();
    const validate = ajv.compile({ ...schema, components: spec.components });
    return validate(body);
  }

  const bodies = [
    { path: '/api/v1/projects', body: { name: 'Ledger' } },
    {
      path: '/api/v1/projects/{id}/tasks',
      body: { externalSystem: 'github', externalId: '7', title: 'Review' },
    },
    {
      path: '/api/v1/projects/{id}/tasks/{taskId}/comments',
      body: { body: 'Filed.' },
    },
    {
      path: '/api/v1/projects/{id}/tasks/{taskId}/start',
      body: { workflowSlug: 'triage' },
    },
    { path: '/api/v1/projects/{id}/folders', body: { name: 'Reports' } },
    { path: '/api/v1/projects/{id}/uploads', body: { fileName: 'report.pdf' } },
    {
      path: '/api/v1/projects/{id}/files',
      body: {
        uploadId: 'u-1',
        fileId: 'f-1',
        folderId: 'fold-1',
        fileName: 'report.pdf',
      },
    },
    { path: '/api/v1/projects/{id}/automations/{name}', body: {} },
    {
      path: '/api/v1/projects/{id}/automations/{name}/runs',
      body: { input: { n: 1 }, mode: 'mock', version: 1 },
    },
    {
      path: '/api/v1/automations/{name}/runs',
      body: { input: { n: 1 }, mode: 'mock', version: 1 },
    },
    { path: '/api/v1/projects/{id}/runs/{runId}/cancel', body: {} },
    { path: '/api/v1/runs/{runId}/cancel', body: {} },
    { path: '/api/v1/threads', body: { title: 'Review' } },
    { path: '/api/v1/projects/{id}/threads', body: { title: 'Review' } },
    {
      path: '/api/v1/threads/{id}/messages',
      body: { content: 'Review', model: 'test' },
    },
    {
      path: '/api/v1/projects/{id}/threads/{threadId}/messages',
      body: { content: 'Review', model: 'test' },
    },
    {
      path: '/api/v1/knowledge/search',
      body: { query: 'Review', corpus: 'all' },
    },
    {
      path: '/api/v1/projects/{id}/knowledge/search',
      body: { query: 'Review', corpus: 'documents' },
    },
  ];
  it.each(bodies)(
    '$path accepts its scoped input and rejects a projectId payload',
    ({ path, body }) => {
      expect(validateBody(path, 'post', body)).toBe(true);
      expect(
        validateBody(path, 'post', { ...body, projectId: 'another-project' }),
      ).toBe(false);
      expect(validateBody(path, 'post', { ...body, arbitrary: true })).toBe(
        false,
      );
    },
  );

  it.each([
    { path: '/api/v1/documents', method: 'post', body: { title: 'Report' } },
    {
      path: '/api/v1/documents/{id}',
      method: 'patch',
      body: { title: 'Revised report' },
    },
  ])(
    '$method $path cannot claim project scope in a Hub request',
    ({ path, method, body }) => {
      expect(validateBody(path, method, body)).toBe(true);
      expect(validateBody(path, method, { ...body, projectId: 'p-1' })).toBe(
        false,
      );
    },
  );

  it('project knowledge search accepts only the project document corpus', () => {
    const path = '/api/v1/projects/{id}/knowledge/search';
    expect(validateBody(path, 'post', { query: 'Review' })).toBe(true);
    expect(validateBody(path, 'post', { query: 'Review', corpus: 'all' })).toBe(
      false,
    );
    expect(validateBody(path, 'post', { query: 'Review', corpus: 'web' })).toBe(
      false,
    );
  });

  it('declares each URL placeholder exactly once as a required path parameter', () => {
    for (const [path, methods] of Object.entries(paths)) {
      const placeholders = [...path.matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method)) continue;
        const params = (operation.parameters ?? []) as Json[];
        const pathParams = params.filter((param) => param.in === 'path');
        expect(
          pathParams.map((param) => String(param.name)).sort(),
          `${method} ${path}`,
        ).toEqual(placeholders);
        expect(
          pathParams.every((param) => param.required === true),
          `${method} ${path}`,
        ).toBe(true);
      }
    }
  });
});

describe('token-authenticated webhook contracts', () => {
  it.each([
    '/api/automations/webhook/{token}',
    '/api/projects/{id}/automations/webhook/{token}',
  ])('%s keeps vendor payloads separate from URL project scope', (path) => {
    const operation = paths[path]?.post;
    expect(operation).toBeDefined();
    expect(operation?.security).toEqual([]);
    const params = (operation?.parameters ?? []) as Json[];
    expect(params.some((param) => param.name === 'projectId')).toBe(false);
    const requestBody = operation?.requestBody as Json | undefined;
    expect(requestBody?.required).toBe(false);
    const content = requestBody?.content as Record<string, Json> | undefined;
    expect(content?.['text/plain']?.schema).toEqual({ type: 'string' });
    const schema = content?.['application/json']?.schema as Json | undefined;
    expect(schema).toBeDefined();
    const validate = ajv.compile(schema ?? {});
    for (const payload of [
      { projectId: 'vendor-event-data' },
      [],
      'event',
      true,
      null,
    ]) {
      expect(validate(payload)).toBe(true);
    }
    const validateResponse = responseValidator(path, 'post', '202');
    expect(validateResponse({ runId: 'run-1', duplicate: true })).toBe(true);
    expect(validateResponse({ runId: 'run-1', duplicate: 'yes' })).toBe(false);
    // Every refusal on the webhook door is the flat JSON envelope — the 404
    // and 413 used to be the one place a sender's JSON error handling could
    // not parse.
    const responses = operation?.responses as Record<string, Json> | undefined;
    for (const status of ['404', '413', '400', '409']) {
      const responseContent = responses?.[status]?.content as
        | Record<string, Json>
        | undefined;
      expect(responseContent?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/Error',
      });
      expect(responseContent?.['text/plain']).toBeUndefined();
    }
  });
});

describe('new project routes answer the published wire schemas', () => {
  const task = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Review',
    status: 'backlog',
    labelIds: [],
    createdAt: 1,
    updatedAt: 2,
    discussionThreadId: null,
  };
  const projectThread = { ...thread, projectId: 'p-1' };
  const projectRun = { ...run, projectId: 'p-1' };
  const sql = fakeSql([], (text) => {
    if (text.includes('FROM app.projects')) return [project];
    if (text.includes('FROM app.tasks WHERE id')) return [task];
    if (text.includes('FROM app.threads t')) return [projectThread];
    if (text.includes('FROM app.automation_runs')) return [projectRun];
    if (text.includes('FROM app.automation_project_bindings'))
      return [{ automationName: automation.name, projectId: 'p-1' }];
    if (text.includes('FROM app.automations a')) return [automation];
    // The version lookup the runs door answers 404 without.
    if (text.includes('FROM app.automations'))
      return [{ name: automation.name, version: 3, document: {} }];
    return [];
  });
  const cases = [
    {
      route: '/projects/p-1/tasks/task-1',
      path: '/api/v1/projects/{id}/tasks/{taskId}',
      factory: createTaskRestRoutes,
    },
    {
      route: '/projects/p-1/tasks/task-1/comments',
      path: '/api/v1/projects/{id}/tasks/{taskId}/comments',
      factory: createTaskRestRoutes,
    },
    {
      route: '/projects/p-1/threads',
      path: '/api/v1/projects/{id}/threads',
      factory: createThreadRestRoutes,
    },
    {
      route: '/projects/p-1/threads/t-1',
      path: '/api/v1/projects/{id}/threads/{threadId}',
      factory: createThreadRestRoutes,
    },
    {
      route: '/projects/p-1/threads/t-1/generation',
      path: '/api/v1/projects/{id}/threads/{threadId}/generation',
      factory: createThreadRestRoutes,
    },
    {
      route: '/projects/p-1/automations',
      path: '/api/v1/projects/{id}/automations',
      factory: createAutomationRestRoutes,
    },
    {
      route: '/projects/p-1/automations/billing__dunning/runs',
      path: '/api/v1/projects/{id}/automations/{name}/runs',
      factory: createAutomationRestRoutes,
    },
    {
      route: '/projects/p-1/runs/run-1',
      path: '/api/v1/projects/{id}/runs/{runId}',
      factory: createAutomationRestRoutes,
    },
    {
      route: '/projects/p-1/runs',
      path: '/api/v1/projects/{id}/runs',
      factory: createAutomationRestRoutes,
    },
  ];
  it.each(cases)('$route', async ({ route, path, factory }) => {
    const response = await mount(factory({ sql })).request(
      `http://localhost${route}`,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const validate = responseValidator(path, 'get', '200');
    expect(
      validate(body),
      JSON.stringify({ errors: validate.errors, body }),
    ).toBe(true);
    if (route.endsWith('/automations'))
      expect(body).toEqual({
        automations: [
          {
            ...automation,
            description: null,
            inputs: null,
            projectIds: ['p-1'],
            trigger: null,
          },
        ],
      });
  });
});

/**
 * The MCP path documents JSON-RPC envelopes of its own — an `id` that can be
 * null on a 400, an array on a batch. OpenAPI 3.0 spells "or null" as
 * `nullable: true` beside a `type`; a `nullable` on a bare `oneOf` compiles
 * nowhere (`"nullable" cannot be used without "type"`), which is what shipped
 * until these replies were held against their schemas.
 */
describe('MCP JSON-RPC envelopes validate against their documented schemas', () => {
  const rc = {
    ctx: { runAction: vi.fn(), runQuery: vi.fn() },
    user: { userId: 'user-1', email: 'user@example.com', name: 'User' },
    org: { organizationId: 'org-1', orgSlug: 'acme' },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler touches exactly this surface
  } as never;
  const post = (body: unknown) =>
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('a single reply and a batch reply validate against the 200 schema', async () => {
    const validate = responseValidator('/api/v1/mcp', 'post', '200');
    const single: unknown = await (
      await handleMcpRequest(
        rc,
        post({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      )
    ).json();
    expect(validate(single), JSON.stringify(validate.errors)).toBe(true);
    const batch: unknown = await (
      await handleMcpRequest(
        rc,
        post([
          { jsonrpc: '2.0', id: 1, method: 'ping' },
          { jsonrpc: '2.0', id: 'b', method: 'resources/list' },
        ]),
      )
    ).json();
    expect(validate(batch), JSON.stringify(validate.errors)).toBe(true);
  });

  it('a parse error, whose id is null, validates against the 400 schema', async () => {
    const validate = responseValidator('/api/v1/mcp', 'post', '400');
    const response = await handleMcpRequest(rc, post('not json at all'));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ id: null, error: { code: -32700 } });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });
});

/**
 * The skill schemas are typed from the file layer's own views: a fixture
 * that satisfies `SkillSummaryView` / `SkillDocumentView` must validate,
 * and — the schemas being closed — a field the view does not carry must
 * not. Used to be `additionalProperties: true` with `canEdit` missing, so
 * a generated client learned nothing about the one field that says whether
 * a save would overwrite a shipped bundle.
 */
describe('skill views validate against the published Skill schemas', () => {
  const summary = {
    slug: 'docx',
    description: 'Word documents',
    visibility: 'org',
    owner: 'user-1',
    icon: 'lucide:file-text',
    labels: ['office'],
    disableModelInvocation: false,
    canEdit: true,
    etag: '"3c2a8f0e1d5b7a9c3c2a8f0e1d5b7a9c3c2a8f0e1d5b7a9c3c2a8f0e1d5b7a9c"',
    updatedAt: 1_700_000_000_000,
  } satisfies SkillSummaryView;
  const document = {
    ...summary,
    body: '# docx\n',
    files: [{ path: 'SKILL.md', size: 1200 }],
  } satisfies SkillDocumentView;

  it('the listing row', () => {
    const validate = responseValidator('/api/v1/skills', 'get', '200');
    const listing = { skills: [summary], failures: [] };
    expect(validate(listing), JSON.stringify(validate.errors)).toBe(true);
  });

  it('the document, and nothing beyond it', () => {
    const validate = responseValidator('/api/v1/skills/{slug}', 'get', '200');
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...document, canEdit: undefined })).toBe(false);
    expect(validate({ ...document, stray: true })).toBe(false);
  });
});

/**
 * The door's contract is stamped on every operation by the post-pass in
 * `spec.ts`; these guards keep the stamp complete — a family that declares
 * its own 404 keeps its sentence but never loses the door's clause, a body
 * operation never ships without its 413, and a read never declares one.
 */
describe('the door-wide contract on every /api/v1 operation', () => {
  const operations = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(
        ([method]) => HTTP_METHODS.has(method) && path.startsWith('/api/v1/'),
      )
      .map(([method, op]) => ({ method, path, op })),
  );
  const responsesOf = (op: Json): Record<string, Json> =>
    (op.responses ?? {}) as Record<string, Json>;
  const text = (value: unknown): string =>
    typeof value === 'string' ? value : '';
  const describes = (
    responses: Record<string, Json>,
    status: string,
    code: string,
  ): boolean => text(responses[status]?.description).includes(code);

  it('declares 405, 500 and the two organization refusals on every operation', () => {
    const missing = operations
      .filter(({ op }) => {
        const responses = responsesOf(op);
        return (
          !describes(responses, '405', 'METHOD_NOT_ALLOWED') ||
          !describes(responses, '500', 'INTERNAL_ERROR') ||
          !describes(responses, '403', 'ORG_FORBIDDEN') ||
          !describes(responses, '404', 'ORG_SLUG_INVALID')
        );
      })
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it('declares 413 on every operation with a body, and on no operation without one', () => {
    const wrong = operations
      .filter(({ op }) => {
        const has413 = responsesOf(op)['413'] !== undefined;
        return op.requestBody === undefined ? has413 : !has413;
      })
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(wrong).toEqual([]);
  });

  it('gives every operation a description, not only a summary', () => {
    const bare = operations
      .filter(
        ({ op }) =>
          typeof op.description !== 'string' || op.description.trim() === '',
      )
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(bare).toEqual([]);
  });

  it('declares every tag an operation uses', () => {
    const declared = new Set(
      ((spec.tags ?? []) as { name: string }[]).map((tag) => tag.name),
    );
    const used = new Set(
      operations.flatMap(({ op }) => (op.tags ?? []) as string[]),
    );
    expect([...used].filter((tag) => !declared.has(tag))).toEqual([]);
  });

  it('types every timestamp as whole epoch milliseconds', () => {
    const schemas = (spec.components as { schemas: Record<string, Json> })
      .schemas;
    const loose: string[] = [];
    for (const [name, schema] of Object.entries(schemas)) {
      const properties = (schema.properties ?? {}) as Record<string, Json>;
      for (const [field, shape] of Object.entries(properties)) {
        if (!/(At|Since|Ms)$/.test(field)) continue;
        const description = text(shape.description);
        if (!description.startsWith('Epoch')) continue;
        if (shape.type !== 'integer') loose.push(`${name}.${field}`);
      }
    }
    expect(loose).toEqual([]);
  });
});

/**
 * An operation whose handler holds the body to a cap of its own — above the
 * door's 1 MiB default (a document's inline content, a bulk import, a skill
 * save) or below it (a delivery claim) — names that cap in its OWN 413, never
 * the door-wide sentence the post-pass stamps: an integrator who sized a
 * client to "1 MiB unless the description says otherwise" had a 1.2 MiB
 * document accepted (round d, S3-7a). The caps are read from the handlers
 * themselves — every `maxBytes:`, `restBodyLimit(` and `readBodyBounded(`
 * inside a route of backend/rest/ — so a cap that moves drags its sentence
 * along, and a new capped route cannot ship on the generic text.
 */
describe('every operation with its own byte cap names it in its 413', () => {
  const restDir = new URL('../../backend/rest/', import.meta.url);
  const MIB = 1024 * 1024;
  const SHARED = new Map<string, number>([['DEFAULT_BODY_BYTES', MIB]]);

  /** `32 * 1024 * 1024` → 33554432; a name → the file's own constant. */
  const evaluate = (
    expression: string,
    constants: ReadonlyMap<string, number>,
  ): number => {
    const trimmed = expression.trim();
    const named = constants.get(trimmed) ?? SHARED.get(trimmed);
    if (named !== undefined) return named;
    if (!/^[\d\s*_]+$/.test(trimmed)) {
      throw new Error(
        `cannot read the byte cap "${trimmed}" — extend the resolver`,
      );
    }
    return trimmed
      .split('*')
      .reduce(
        (total, factor) => total * Number(factor.replace(/[\s_]/g, '')),
        1,
      );
  };

  const caps = new Map<string, number>();
  for (const file of readdirSync(restDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL(file, restDir), 'utf8');
    const constants = new Map<string, number>();
    for (const match of source.matchAll(
      /^const ([A-Z_]+_BYTES) = ([^;]+);/gm,
    )) {
      constants.set(match[1] ?? '', evaluate(match[2] ?? '', constants));
    }
    const routes = [
      ...source.matchAll(
        /app\s*\.\s*(get|post|put|patch|delete)\(\s*'([^']+)'/g,
      ),
    ];
    routes.forEach((route, index) => {
      const block = source.slice(
        route.index,
        routes[index + 1]?.index ?? source.length,
      );
      const sites = [
        ...block.matchAll(/maxBytes:\s*([^,}\n]+)/g),
        ...block.matchAll(/restBodyLimit\(\s*([^)]+?)\s*\)/g),
        ...block.matchAll(/readBodyBounded\([^,]+,\s*([^)]+?)\s*\)/g),
      ];
      for (const site of sites) {
        const cap = evaluate(site[1] ?? '', constants);
        if (cap === MIB) continue;
        caps.set(
          `${(route[1] ?? '').toUpperCase()} ${openapiPath(route[2] ?? '')}`,
          cap,
        );
      }
    });
  }

  it('sees the caps the handlers hold their bodies to', () => {
    expect([...caps.keys()].sort()).toEqual([
      'PATCH /api/v1/documents/{id}',
      'POST /api/v1/contacts/bulk',
      'POST /api/v1/conversations/deliveries/claim',
      'POST /api/v1/conversations/deliveries/{id}/ack',
      'POST /api/v1/conversations/deliveries/{id}/fail',
      'POST /api/v1/conversations/sync',
      'POST /api/v1/conversations/uploads',
      'POST /api/v1/documents',
      'PUT /api/v1/skills/{slug}',
    ]);
  });

  it('names each cap in the operation’s own 413', () => {
    const wrong = [...caps]
      .filter(([key, cap]) => {
        const [method = '', path = ''] = key.split(' ');
        const op = paths[path]?.[method.toLowerCase()];
        const responses = (op?.responses ?? {}) as Record<string, Json>;
        const description = responses['413']?.description;
        const sentence = typeof description === 'string' ? description : '';
        return (
          !sentence.includes(describeByteCap(cap)) ||
          !sentence.includes('BODY_TOO_LARGE') ||
          sentence.includes('unless the description says otherwise')
        );
      })
      .map(([key, cap]) => `${key} (${describeByteCap(cap)})`);
    expect(wrong).toEqual([]);
  });
});

/**
 * The pagination families the preamble promises, held to the document — the
 * envelope-family guard round b's A-11 promised and never landed. Every list
 * operation (an `operationId` starting with `list`) declares its family in
 * `x-tale-pagination`, and the family dictates the shape: keyset answers
 * `isDone` + `continueCursor` (required) and takes `cursor` + `limit`; offset
 * answers `total`/`offset`/`hasMore` beside that pair and takes `offset` too;
 * none answers neither `isDone` nor a cursor and takes no `cursor`/`limit`.
 * The preamble's Pagination bullets name every collection key in the bullet
 * of its family, so the prose cannot drift from the schemas again (the
 * `{deliveries}` slip of 1.4.0).
 */
describe('the pagination families', () => {
  const FAMILIES = ['keyset', 'offset', 'none'] as const;
  const schemas = (spec.components as { schemas: Record<string, Json> })
    .schemas;
  const resolve = (schema: Json | undefined): Json => {
    if (schema === undefined) return {};
    const $ref = schema.$ref;
    return typeof $ref === 'string'
      ? (schemas[$ref.replace('#/components/schemas/', '')] ?? {})
      : schema;
  };
  const lists = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(
        ([method, op]) =>
          HTTP_METHODS.has(method) &&
          typeof op.operationId === 'string' &&
          op.operationId.startsWith('list'),
      )
      .map(([method, op]) => {
        const responses = (op.responses ?? {}) as Record<string, Json>;
        const content = (responses['200']?.content ?? {}) as Record<
          string,
          Json
        >;
        const envelope = resolve(
          content['application/json']?.schema as Json | undefined,
        );
        const properties = (envelope.properties ?? {}) as Record<string, Json>;
        const declared = envelope['x-tale-pagination'];
        return {
          name: `${method.toUpperCase()} ${path}`,
          family: FAMILIES.find((family) => family === declared),
          key:
            Object.entries(properties).find(
              ([, shape]) => shape.type === 'array',
            )?.[0] ?? '',
          params: ((op.parameters ?? []) as { name: string; in: string }[])
            .filter((parameter) => parameter.in === 'query')
            .map((parameter) => parameter.name),
          properties,
          required: (envelope.required ?? []) as string[],
        };
      }),
  );

  it('sees every list operation', () => {
    expect(lists.length).toBeGreaterThanOrEqual(28);
  });

  it('declares a family on every list operation', () => {
    expect(
      lists
        .filter(({ family }) => family === undefined)
        .map(({ name }) => name),
    ).toEqual([]);
  });

  it('keyset: isDone + continueCursor required, cursor + limit taken, a cursor twin deprecated and optional', () => {
    const wrong = lists
      .filter(({ family }) => family === 'keyset')
      .filter(
        ({ required, params, properties }) =>
          !required.includes('isDone') ||
          !required.includes('continueCursor') ||
          !params.includes('cursor') ||
          !params.includes('limit') ||
          ('cursor' in properties &&
            (properties.cursor?.deprecated !== true ||
              required.includes('cursor'))),
      )
      .map(({ name }) => name);
    expect(wrong).toEqual([]);
  });

  it('offset: website pages alone — the offset trio beside the keyset pair, offset + cursor + limit taken', () => {
    const offsetLists = lists.filter(({ family }) => family === 'offset');
    expect(offsetLists.map(({ name }) => name)).toEqual([
      'GET /api/v1/websites/{id}/pages',
    ]);
    const wrong = offsetLists
      .filter(
        ({ required, params }) =>
          ![
            'pages',
            'total',
            'offset',
            'hasMore',
            'isDone',
            'continueCursor',
          ].every((field) => required.includes(field)) ||
          !['offset', 'cursor', 'limit'].every((name) => params.includes(name)),
      )
      .map(({ name }) => name);
    expect(wrong).toEqual([]);
  });

  it('none: no isDone, no cursor field, no cursor or limit parameter', () => {
    const wrong = lists
      .filter(({ family }) => family === 'none')
      .filter(
        ({ properties, params }) =>
          'isDone' in properties ||
          'continueCursor' in properties ||
          'cursor' in properties ||
          params.includes('cursor') ||
          params.includes('limit'),
      )
      .map(({ name }) => name);
    expect(wrong).toEqual([]);
  });

  it('names every collection key in the preamble bullet of its family', () => {
    const info = spec.info as { description?: string };
    const description = info.description ?? '';
    const section = description.slice(
      description.indexOf('## Pagination'),
      description.indexOf('## Rate limits'),
    );
    const bullets = new Map<string, string>();
    for (const match of section.matchAll(
      /^- \*\*(keyset|offset|none)\*\* — ([\s\S]*?)(?=\n- \*\*|\n\n)/gm,
    )) {
      bullets.set(match[1] ?? '', match[2] ?? '');
    }
    expect([...bullets.keys()].sort()).toEqual([...FAMILIES].sort());
    const unnamed = lists
      .filter(({ family, key }) => {
        const bullet = bullets.get(family ?? '') ?? '';
        return !bullet.includes(key === 'page' ? '`page`' : `\`{${key}`);
      })
      .map(({ name, key }) => `${name} ({${key}})`);
    expect(unnamed).toEqual([]);
  });
});

/**
 * Every request body on the door is strict — an unknown key answers 400
 * `INVALID_BODY` naming it, the reference's "Every body schema is strict"
 * — so the document says so too: every object schema an
 * `application/json` request body declares, inline or through a `$ref`,
 * an `allOf`/`oneOf`/`anyOf` member or an array's items, carries
 * `additionalProperties: false`. The bulk contacts body shipped without
 * it (2026-09-13 round-e evaluation, E1-05a), so a generated client typed
 * it open while the wire refused a stray key. Two kinds of door are open
 * on purpose: the MCP door (JSON-RPC, whose `params` are each tool's own
 * schema) and the two webhook doors (any JSON value is the payload).
 */
describe('every JSON request body is strict', () => {
  const OPEN_BY_DESIGN: ReadonlySet<string> = new Set([
    'POST /api/v1/mcp',
    'POST /api/automations/webhook/{token}',
    'POST /api/projects/{id}/automations/webhook/{token}',
  ]);
  const schemas = (spec.components as { schemas: Record<string, Json> })
    .schemas;
  const resolve = (schema: Json): Json =>
    typeof schema.$ref === 'string'
      ? (schemas[schema.$ref.replace('#/components/schemas/', '')] ?? {})
      : schema;
  const objectShaped = (shape: Json): boolean =>
    shape.type === 'object' || shape.properties !== undefined;
  /** The object schemas under `at` that leave an unknown key unrefused. */
  const open = (schema: Json, at: string, found: string[]): void => {
    const shape = resolve(schema);
    for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
      ((shape[key] ?? []) as Json[]).forEach((member, index) => {
        open(member, `${at}.${key}[${index}]`, found);
      });
    }
    if (shape.type === 'array' && shape.items !== undefined) {
      open(shape.items as Json, `${at}[]`, found);
    }
    if (objectShaped(shape) && shape.additionalProperties !== false) {
      found.push(at);
    }
  };
  const bodies = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(([method]) => HTTP_METHODS.has(method))
      .flatMap(([method, op]) => {
        const content = ((op.requestBody as Json | undefined)?.content ??
          {}) as Record<string, Json>;
        const schema = content['application/json']?.schema as Json | undefined;
        return schema === undefined
          ? []
          : [{ name: `${method.toUpperCase()} ${path}`, schema }];
      }),
  );

  it('sees the bodies', () => {
    expect(bodies.length).toBeGreaterThan(40);
  });

  it('declares additionalProperties: false on every object a request body carries, the open doors excepted', () => {
    const found: string[] = [];
    for (const { name, schema } of bodies) {
      if (!OPEN_BY_DESIGN.has(name)) open(schema, name, found);
    }
    expect(found).toEqual([]);
  });

  it('keeps the open list honest — every door on it exists and leaves its body open', () => {
    for (const name of OPEN_BY_DESIGN) {
      const body = bodies.find((candidate) => candidate.name === name);
      expect(body, name).toBeDefined();
      const found: string[] = [];
      open(body?.schema ?? {}, name, found);
      // Open: an object that admits unknown keys somewhere in the body,
      // or a body that is no object at all (any JSON value).
      const freeForm = !objectShaped(resolve(body?.schema ?? {}));
      expect(found.length > 0 || freeForm, name).toBe(true);
    }
  });
});

/**
 * A window a client may size is bounded in the document, not only in the
 * prose: every `limit` query parameter declares `minimum`, `maximum` and
 * `default`, every `offset` its `minimum` and `default` — the website
 * pages list declared bare integers with "1..500 (default 100)" in its
 * description alone (2026-09-13 round-e evaluation, E1-05e), the one list
 * a generated client could not bound.
 */
describe('every limit and offset query parameter is bounded', () => {
  const windows = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(([method]) => HTTP_METHODS.has(method))
      .flatMap(([method, op]) =>
        (
          (op.parameters ?? []) as {
            name: string;
            in: string;
            schema?: Json;
          }[]
        )
          .filter(
            (parameter) =>
              parameter.in === 'query' &&
              (parameter.name === 'limit' || parameter.name === 'offset'),
          )
          .map((parameter) => ({
            name: `${method.toUpperCase()} ${path}`,
            parameter: parameter.name,
            schema: parameter.schema ?? {},
          })),
      ),
  );
  const whole = (value: unknown): boolean => Number.isInteger(value);

  it('sees every limit', () => {
    expect(
      windows.filter(({ parameter }) => parameter === 'limit').length,
    ).toBeGreaterThanOrEqual(16);
  });

  it('declares minimum, maximum and default on every limit', () => {
    const bare = windows
      .filter(
        ({ parameter, schema }) =>
          parameter === 'limit' &&
          !(
            schema.type === 'integer' &&
            whole(schema.minimum) &&
            whole(schema.maximum) &&
            whole(schema.default)
          ),
      )
      .map(({ name }) => name);
    expect(bare).toEqual([]);
  });

  it('declares minimum and default on every offset', () => {
    const bare = windows
      .filter(
        ({ parameter, schema }) =>
          parameter === 'offset' &&
          !(
            schema.type === 'integer' &&
            whole(schema.minimum) &&
            whole(schema.default)
          ),
      )
      .map(({ name }) => name);
    expect(bare).toEqual([]);
  });
});

describe('the response headers the prose leans on are declared', () => {
  const apiOps = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(
        ([method]) => HTTP_METHODS.has(method) && path.startsWith('/api/v1/'),
      )
      .map(([method, op]) => ({ path, method, op })),
  );
  const headersOf = (response: Json) =>
    Object.keys((response.headers ?? {}) as Record<string, unknown>);

  it('names X-Request-Id and X-Tale-Api-Version on every response of every operation', () => {
    const missing = apiOps.flatMap(({ path, method, op }) =>
      Object.entries(op.responses as Record<string, Json>)
        .filter(([, response]) => {
          const names = headersOf(response);
          return (
            !names.includes('X-Request-Id') ||
            !names.includes('X-Tale-Api-Version')
          );
        })
        .map(([status]) => `${method.toUpperCase()} ${path} ${status}`),
    );
    expect(missing).toEqual([]);
  });

  it('names the header a status implies: a 401 challenge, a 405 Allow, a 429 wait', () => {
    const missing = apiOps.flatMap(({ path, method, op }) =>
      Object.entries(op.responses as Record<string, Json>)
        .filter(([status, response]) => {
          const names = headersOf(response);
          if (status === '401') return !names.includes('WWW-Authenticate');
          if (status === '405') return !names.includes('Allow');
          if (status === '429') return !names.includes('Retry-After');
          return false;
        })
        .map(([status]) => `${method.toUpperCase()} ${path} ${status}`),
    );
    expect(missing).toEqual([]);
  });

  it('declares the download’s own headers on its 200, 206 and 416', () => {
    const download = paths['/api/v1/projects/{id}/files/{documentId}/content']
      ?.get as Json;
    const responses = download.responses as Record<string, Json>;
    for (const status of ['200', '206']) {
      expect(headersOf(responses[status] ?? {})).toEqual(
        expect.arrayContaining([
          'Content-Disposition',
          'Content-Length',
          'ETag',
          'Last-Modified',
          'Accept-Ranges',
        ]),
      );
    }
    expect(headersOf(responses['206'] ?? {})).toContain('Content-Range');
    expect(headersOf(responses['416'] ?? {})).toContain('Content-Range');
    expect(responses['416']?.content).toBeUndefined();
  });

  it('resolves every header reference to a declared component', () => {
    const components = (spec.components as Json).headers as Record<
      string,
      Json
    >;
    const dangling = apiOps.flatMap(({ path, method, op }) =>
      Object.values(op.responses as Record<string, Json>).flatMap((response) =>
        Object.values((response.headers ?? {}) as Record<string, Json>)
          .map((header) => (typeof header.$ref === 'string' ? header.$ref : ''))
          .filter(
            (ref) =>
              ref !== '' &&
              components[ref.replace('#/components/headers/', '')] ===
                undefined,
          )
          .map((ref) => `${method.toUpperCase()} ${path} ${ref}`),
      ),
    );
    expect(dangling).toEqual([]);
  });

  it('takes the caller’s own X-Request-Id on every operation', () => {
    const missing = apiOps
      .filter(
        ({ op }) =>
          !((op.parameters ?? []) as Json[]).some(
            (parameter) =>
              parameter.in === 'header' && parameter.name === 'X-Request-Id',
          ),
      )
      .map(({ path, method }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });
});

describe('the error envelope', () => {
  it('requires the code the prose tells a client to branch on', () => {
    const error = ((spec.components as Json).schemas as Record<string, Json>)
      .Error as Json;
    expect(error.required).toEqual(['error', 'code']);
  });
});

/**
 * Codes the registry carries that no operation names — a client could
 * not learn from the document which call answers them. The list was paid
 * down to nothing in the 2026-09-12 campaign and stays empty: a NEW code
 * is named in the response description of the operation whose domain call
 * throws it (or leaves the registry for `APP_ONLY_CODES`, when no REST
 * route can provoke it). The guard below refuses a registry entry that is
 * neither named nor listed here, and refuses a listed entry that gained a
 * home — so an entry here is a conscious, temporary debt, never a default.
 */
const UNNAMED_CODES: ReadonlySet<string> = new Set<string>([]);

describe('every error code has a home in the document', () => {
  const codeMentions = (text: unknown): string[] =>
    typeof text === 'string'
      ? [...text.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1] ?? '')
      : [];
  const namedByOperations = new Set<string>();
  for (const ops of Object.values(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!HTTP_METHODS.has(method)) continue;
      for (const text of [op.summary, op.description]) {
        for (const code of codeMentions(text)) namedByOperations.add(code);
      }
      for (const response of Object.values(
        (op.responses ?? {}) as Record<string, Json>,
      )) {
        for (const code of codeMentions(response.description)) {
          namedByOperations.add(code);
        }
      }
      for (const parameter of (op.parameters ?? []) as Json[]) {
        for (const code of codeMentions(parameter.description)) {
          namedByOperations.add(code);
        }
      }
      for (const code of codeMentions(
        ((op.requestBody ?? {}) as Json).description,
      )) {
        namedByOperations.add(code);
      }
    }
  }
  const namedByPreamble = new Set(
    codeMentions((spec.info as Json).description),
  );

  it('names every registered code in an operation or in the preamble, or lists it as debt', () => {
    const homeless = REST_ERROR_CODES.filter(
      (code) =>
        !namedByOperations.has(code) &&
        !namedByPreamble.has(code) &&
        !UNNAMED_CODES.has(code),
    );
    expect(homeless).toEqual([]);
  });

  it('keeps the debt list honest — a code that gained a home leaves it', () => {
    const paidDown = [...UNNAMED_CODES].filter(
      (code) => namedByOperations.has(code) || namedByPreamble.has(code),
    );
    expect(paidDown).toEqual([]);
  });

  it('lists only registered codes as debt', () => {
    const registered = new Set<string>(REST_ERROR_CODES);
    expect([...UNNAMED_CODES].filter((code) => !registered.has(code))).toEqual(
      [],
    );
  });
});

describe('the contract version moves with the contract', () => {
  const recorded: { version: string; operations: string; schemas: string } =
    JSON.parse(
      readFileSync(
        new URL('./contract-fingerprint.json', import.meta.url),
        'utf8',
      ),
    );
  const current = contractFingerprint(spec);
  const version = String((spec.info as Json).version);

  it('records the fingerprint of the published document (bun run generate:openapi)', () => {
    // The generator writes the fingerprint beside public/openapi.json; a
    // document rebuilt without it is out of date the same way.
    expect(current).toEqual({
      operations: recorded.operations,
      schemas: recorded.schemas,
    });
  });

  it('carries the version the fingerprint was recorded with', () => {
    expect(version).toBe(recorded.version);
  });

  it('states the version as semver and names it in the API_CONTRACT_VERSION constant', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

/**
 * The delegated notification export names its capability where a client
 * reads it — the export's description and 403, and
 * `Me.capabilities.notificationExport` — so the slug the document prints
 * must be one the competence register grants: a renamed capability would
 * otherwise send an operator to grant a slug the register refuses.
 */
describe('the notification export capability in the published document', () => {
  const slug = 'tale:notifications.export';
  const sync = paths['/api/v1/notifications/sync'].get as {
    description: string;
    responses: Record<string, { description: string }>;
  };
  const me = (spec.components as { schemas: Record<string, Json> }).schemas
    .Me as {
    properties: {
      capabilities: {
        required: string[];
        properties: Record<string, { description: string }>;
      };
    };
  };

  it('names a capability the competence register grants', () => {
    expect(PLATFORM_CAPABILITIES).toContain(slug);
    expect(sync.description).toContain(slug);
    expect(sync.responses['403'].description).toContain(slug);
  });

  it('declares the /me pre-flight beside the other capabilities', () => {
    const { capabilities } = me.properties;
    expect(capabilities.required).toContain('notificationExport');
    expect(capabilities.properties.notificationExport.description).toContain(
      slug,
    );
  });
});

/**
 * Every JSON read is a validated read (`lib/conditional-get.ts`): the
 * generator stamps the `ETag`/`Cache-Control` headers and the 304 on each
 * of them, and on nothing else — a `jsonResponse` refactor that dropped the
 * stamp would silently un-declare 44 operations.
 */
describe('validated reads in the published document', () => {
  const gets = Object.entries(paths).flatMap(([path, operations]) => {
    const op = (operations as Record<string, Json | undefined>).get;
    return op === undefined ? [] : [[path, op] as const];
  });

  it('declare ETag, Cache-Control and a 304 on every JSON GET', () => {
    const json = gets.filter(([, op]) => {
      const ok = (op.responses as Record<string, Json>)['200'] as
        | { content?: Record<string, Json> }
        | undefined;
      return ok?.content?.['application/json'] !== undefined;
    });
    expect(json.length).toBeGreaterThan(40);
    for (const [path, op] of json) {
      const responses = op.responses as Record<string, Json>;
      const ok = responses['200'] as { headers?: Record<string, Json> };
      expect(ok.headers?.ETag, path).toBeDefined();
      expect(ok.headers?.['Cache-Control'], path).toBeDefined();
      expect(responses['304'], path).toBeDefined();
    }
  });

  it('declare no body validator on a GET that answers no JSON and no 304', () => {
    // A download that VALIDATES declares the store's own validators — its
    // `ETag`/`Last-Modified` ride the bytes — and a 304 to go with them (the
    // skills file read, 2026-09-18 evaluation, J1-1). A download that does
    // not (an attachment stream) carries neither, so no JSON-read validator
    // is ever stamped onto a binary answer by mistake.
    const other = gets.filter(([, op]) => {
      const responses = op.responses as Record<string, Json>;
      const ok = responses['200'] as
        | { content?: Record<string, Json> }
        | undefined;
      return (
        ok?.content?.['application/json'] === undefined &&
        ok?.content?.['*/*'] === undefined &&
        responses['304'] === undefined
      );
    });
    expect(other.length).toBeGreaterThan(0);
    for (const [path, op] of other) {
      const ok = (op.responses as Record<string, Json>)['200'] as {
        headers?: Record<string, Json>;
      };
      expect(ok.headers?.ETag, path).toBeUndefined();
    }
    // A binary GET that declares a 304 must carry the validators that make it
    // meaningful — `ETag` and `Last-Modified` on the 200.
    const validated = gets.filter(([, op]) => {
      const responses = op.responses as Record<string, Json>;
      const ok = responses['200'] as
        | { content?: Record<string, Json> }
        | undefined;
      return (
        ok?.content?.['application/json'] === undefined &&
        ok?.content?.['*/*'] === undefined &&
        responses['304'] !== undefined
      );
    });
    for (const [path, op] of validated) {
      const ok = (op.responses as Record<string, Json>)['200'] as {
        headers?: Record<string, Json>;
      };
      expect(ok.headers?.ETag, path).toBeDefined();
      expect(ok.headers?.['Last-Modified'], path).toBeDefined();
    }
  });
});

describe('the shapes the 2026-09-14 round-h evaluation found generated clients tripping on', () => {
  const walk = (
    node: unknown,
    visit: (value: Record<string, unknown>, at: string) => void,
    at = '$',
  ): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, visit, `${at}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a non-null, non-array object
    const record = node as Record<string, unknown>;
    visit(record, at);
    for (const [key, value] of Object.entries(record)) {
      walk(value, visit, `${at}.${key}`);
    }
  };

  it('lists null in every nullable enum — OAS 3.0 widens the type, never the enum', () => {
    let seen = 0;
    walk(spec, (value, at) => {
      if (value.nullable === true && Array.isArray(value.enum)) {
        seen += 1;
        expect(value.enum, at).toContain(null);
      }
    });
    expect(seen).toBeGreaterThan(5);
  });

  // A Reference Object cannot be extended (OAS 3.0.3 §4.7.23): `nullable`
  // or `description` beside `$ref` is ignored by every reader, so the three
  // 1.16.0 read doors typed their documented `null` as non-null in every
  // generated client (2026-09-19 evaluation, K9-1). Redocly's
  // `spec-ref-siblings` and Spectral's `no-$ref-siblings` refuse the same.
  it('gives no Reference Object a sibling keyword', () => {
    const siblings: string[] = [];
    let references = 0;
    walk(spec, (value, at) => {
      if (typeof value.$ref !== 'string') return;
      references += 1;
      if (Object.keys(value).length > 1) siblings.push(at);
    });
    expect(references).toBeGreaterThan(1000);
    expect(siblings).toEqual([]);
  });

  // `nullable` applies only where `type` is defined in the same Schema
  // Object (§4.7.24); a reference is widened through an `allOf` wrapper and
  // a typeless `oneOf` carries the keyword on each branch — the two shapes
  // Redocly's lint failed the 1.17.0 document on (K9-1, K9-2).
  it('puts every nullable beside a type or an allOf-wrapped reference', () => {
    const typeless: string[] = [];
    let seen = 0;
    walk(spec, (value, at) => {
      if (value.nullable !== true) return;
      seen += 1;
      const typed = typeof value.type === 'string';
      const wrapped =
        Array.isArray(value.allOf) &&
        value.allOf.length === 1 &&
        typeof (value.allOf[0] as Json).$ref === 'string';
      if (!typed && !wrapped) typeless.push(at);
    });
    expect(seen).toBeGreaterThan(20);
    expect(typeless).toEqual([]);
  });

  it('declares the idle answer of the ask and review doors as a nullable reference', () => {
    const doors = [
      ['/api/v1/runs/{runId}/ask', 'ask', 'PendingAsk'],
      ['/api/v1/projects/{id}/runs/{runId}/ask', 'ask', 'PendingAsk'],
      ['/api/v1/projects/{id}/tasks/{taskId}/review', 'review', 'TaskReview'],
    ] as const;
    for (const [path, property, schema] of doors) {
      const op = paths[path]?.get as Json | undefined;
      expect(op, path).toBeDefined();
      if (op === undefined) continue;
      const body = (
        (
          ((op.responses as Record<string, Json>)['200'] as Json)
            .content as Record<string, Json>
        )['application/json'] as Json
      ).schema as Json;
      const declared = (body.properties as Record<string, Json>)[property];
      expect(declared, path).toEqual({
        allOf: [{ $ref: `#/components/schemas/${schema}` }],
        nullable: true,
      });
    }
  });

  it('names the created resource in Location on every 201 that creates one addressable resource', () => {
    const located: string[] = [];
    const unlocated: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(operations)) {
        if (!HTTP_METHODS.has(method)) continue;
        const created = (op.responses as Record<string, Json>)['201'] as
          | { headers?: Record<string, Json> }
          | undefined;
        if (created === undefined) continue;
        (created.headers?.Location === undefined ? unlocated : located).push(
          `${method.toUpperCase()} ${path}`,
        );
      }
    }
    expect(located.sort()).toEqual([
      'POST /api/v1/contacts',
      'POST /api/v1/documents',
      'POST /api/v1/knowledge-entries',
      'POST /api/v1/products',
      'POST /api/v1/projects',
      'POST /api/v1/projects/{id}/agents',
      'POST /api/v1/projects/{id}/files',
      'POST /api/v1/projects/{id}/folders',
      'POST /api/v1/projects/{id}/tasks',
      'POST /api/v1/projects/{id}/threads',
      'POST /api/v1/threads',
      'POST /api/v1/websites',
      'PUT /api/v1/skills/{slug}',
    ]);
    // The creates with nothing to point at: many rows, a row with no read
    // of its own, or an install answering the project's automation view.
    expect(unlocated.sort()).toEqual([
      'POST /api/v1/browser-sessions/import',
      'POST /api/v1/contacts/bulk',
      'POST /api/v1/projects/{id}/automations/{name}',
      'POST /api/v1/projects/{id}/tasks/{taskId}/comments',
    ]);
  });

  it('declares the vocabulary of every enum query filter the handlers validate', () => {
    const enumOf = (path: string, name: string) => {
      const parameters = (paths[path]?.get?.parameters ?? []) as {
        name: string;
        schema?: { enum?: unknown[] };
      }[];
      return parameters.find((parameter) => parameter.name === name)?.schema
        ?.enum;
    };
    expect(enumOf('/api/v1/conversations', 'contactStatus')).toEqual([
      ...API_CONTACT_STATUSES,
    ]);
    expect(enumOf('/api/v1/products', 'status')).toEqual([...PRODUCT_STATUSES]);
    expect(enumOf('/api/v1/websites', 'scanInterval')).toEqual([
      '60m',
      '6h',
      '12h',
      '1d',
      '5d',
      '7d',
      '30d',
    ]);
    expect(enumOf('/api/v1/websites', 'status')).not.toContain('idle');
  });
});

// ── OpenAPI 3.0 discipline the generators and validators hold us to ─────────

describe('MessagePart is a discriminator a strict client can resolve', () => {
  // A discriminator with no `mapping` over inline branches resolves
  // `type: "text"` to `#/components/schemas/text`, which never existed, so
  // a discriminator-honouring validator rejected every chat message
  // (2026-09-15 evaluation, i9). Every branch is a named schema now and the
  // mapping is explicit — a generated client gets a class per kind.
  const schemas = (spec.components as { schemas: Record<string, Json> })
    .schemas;
  const part = schemas.MessagePart as {
    discriminator: { propertyName: string; mapping: Record<string, string> };
    oneOf: { $ref: string }[];
  };

  it('lists exactly the schemas its mapping names, every one a $ref', () => {
    expect(part.discriminator.propertyName).toBe('type');
    const mapped = Object.values(part.discriminator.mapping).sort();
    const listed = part.oneOf.map((branch) => branch.$ref).sort();
    expect(listed).toEqual(mapped);
    expect(mapped).toHaveLength(7);
  });

  it('maps each kind to a schema whose required `type` is that kind alone', () => {
    for (const [kind, target] of Object.entries(part.discriminator.mapping)) {
      const name = target.replace('#/components/schemas/', '');
      const schema = schemas[name] as {
        required?: string[];
        properties?: { type?: { enum?: string[] } };
      };
      expect(schema, name).toBeDefined();
      expect(schema.required, name).toContain('type');
      expect(schema.properties?.type?.enum, name).toEqual([kind]);
    }
  });
});

describe('the document is OpenAPI 3.0', () => {
  it('declares nullability with `nullable`, never a 3.1 type list', () => {
    // One `type: ['string', 'null']` made the whole document invalid to
    // every 3.0 validator, and crashed one (2026-09-15 evaluation, i9).
    const offenders: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${at}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.type)) offenders.push(at);
      for (const [key, value] of Object.entries(record))
        walk(value, `${at}.${key}`);
    };
    walk(spec, '$');
    expect(offenders).toEqual([]);
    expect(spec.openapi).toBe('3.0.3');
  });

  it('gives every enum unique items', () => {
    // OAS 3.0.3 requires `enum` items to be unique; `budget_exceeded`
    // appeared twice in the three `failureCode` enums, the only three errors
    // in the document, and `openapi-python-client` aborted on it by default
    // (2026-09-18 evaluation, J9-1).
    const offenders: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${at}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.enum)) {
        const values = record.enum.map((value) => JSON.stringify(value));
        if (new Set(values).size !== values.length) offenders.push(at);
      }
      for (const [key, value] of Object.entries(record))
        walk(value, `${at}.${key}`);
    };
    walk(spec, '$');
    expect(offenders).toEqual([]);
  });
});
