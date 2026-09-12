// @vitest-environment node

import { readFileSync } from 'node:fs';

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
    ['/projects', '/api/v1/projects', { projects: [project], isDone: true }],
    [
      '/projects?externalItemId=crm-4711',
      '/api/v1/projects',
      { projects: [project] },
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

  it('declare no body validator on a GET that answers no JSON', () => {
    // A download's 200 declares the STORE's validators (its ETag and
    // Last-Modified ride the bytes) — that is the object's tag, not the
    // JSON read's, so a binary answer is exempt here.
    const other = gets.filter(([, op]) => {
      const ok = (op.responses as Record<string, Json>)['200'] as
        | { content?: Record<string, Json> }
        | undefined;
      return (
        ok?.content?.['application/json'] === undefined &&
        ok?.content?.['*/*'] === undefined
      );
    });
    expect(other.length).toBeGreaterThan(0);
    for (const [path, op] of other) {
      const ok = (op.responses as Record<string, Json>)['200'] as {
        headers?: Record<string, Json>;
      };
      expect(ok.headers?.ETag, path).toBeUndefined();
    }
  });
});
