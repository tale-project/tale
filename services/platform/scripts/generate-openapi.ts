/**
 * Generate `public/openapi.json` — the spec behind the Swagger UI at `/docs`.
 *
 * The spec is built statically from this file: every path below corresponds to
 * a route registered in `convex/http.ts`, and the drift guard
 * (`convex/lib/rest/openapi_spec.test.ts`) fails the build when the two
 * disagree in either direction. When you add, move, or remove a `/api/v1`
 * route, this file changes in the same commit.
 *
 * The documents/websites/products path items and their schemas predate this
 * generator's rewrite and are carried verbatim in `scripts/openapi/
 * legacy-paths.json` + `legacy-schemas.json` — those two files are their
 * editable source now.
 *
 * Run with `bun run generate:openapi`. Output is deterministic: no network,
 * no deployment, no timestamps.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import legacyPaths from './openapi/legacy-paths.json';
import legacySchemas from './openapi/legacy-schemas.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const platformDir = join(__dirname, '..');

// ── Small builders ───────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const sec = [{ bearerAuth: [] }];

/** The flat error envelope every non-2xx response carries. */
function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  };
}

const standardErrors = {
  '400': errorResponse('Invalid request (malformed body or parameters)'),
  '401': errorResponse('Missing or invalid API key'),
  '429': errorResponse('Rate limit exceeded'),
};

function jsonBody(schema: Json, required = true) {
  return { required, content: { 'application/json': { schema } } };
}

function jsonResponse(description: string, schema?: Json) {
  if (!schema) return { description };
  return { description, content: { 'application/json': { schema } } };
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` };
}

function pathParam(name: string, description: string) {
  return {
    name,
    in: 'path' as const,
    required: true,
    schema: { type: 'string' },
    description,
  };
}

function queryParam(
  name: string,
  description: string,
  opts?: { type?: string },
) {
  return {
    name,
    in: 'query' as const,
    required: false,
    schema: { type: opts?.type ?? 'string' },
    description,
  };
}

const paginationParams = [
  queryParam('cursor', 'Pagination cursor from a previous response'),
  queryParam('limit', 'Maximum number of items to return', {
    type: 'integer',
  }),
];

/** A paginated envelope: `{page: [...], isDone, continueCursor}`. */
function pageOf(item: Json): Json {
  return {
    type: 'object',
    required: ['page', 'isDone', 'continueCursor'],
    properties: {
      page: { type: 'array', items: item },
      isDone: { type: 'boolean' },
      continueCursor: { type: 'string', nullable: true },
    },
  };
}

const automationNameParam = pathParam(
  'name',
  'The automation name — a `/`-separated slug written with `__` in place of ' +
    'each `/` (`billing/dunning` travels as `billing__dunning`). Responses ' +
    'always carry the real slug.',
);

// ── The spec ─────────────────────────────────────────────────────────────────

function buildSpec(): Json {
  const paths: Record<string, Json> = {};

  // Documents / Websites / Products — carried verbatim (see header).
  Object.assign(paths, legacyPaths as Record<string, Json>);

  // ── Contacts ──────────────────────────────────────────────────────────────

  paths['/api/v1/contacts'] = {
    get: {
      tags: ['Contacts'],
      summary: 'List contacts',
      operationId: 'listContacts',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('source', 'Filter by source'),
        queryParam('locale', 'Filter by locale'),
      ],
      responses: {
        '200': jsonResponse('Paginated contacts', pageOf(ref('Contact'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Contacts'],
      summary: 'Create contact',
      operationId: 'createContact',
      security: sec,
      requestBody: jsonBody(ref('Contact')),
      responses: {
        '200': jsonResponse('Created contact', ref('Contact')),
        '409': errorResponse('Duplicate email or external id'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/bulk'] = {
    post: {
      tags: ['Contacts'],
      summary: 'Create contacts in bulk',
      operationId: 'bulkCreateContacts',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['contacts'],
        properties: {
          contacts: { type: 'array', items: ref('Contact') },
        },
      }),
      responses: {
        '200': jsonResponse('Bulk creation result'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/{id}'] = {
    get: {
      tags: ['Contacts'],
      summary: 'Get contact',
      operationId: 'getContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      responses: {
        '200': jsonResponse('Contact', ref('Contact')),
        '404': errorResponse('Contact not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Contacts'],
      summary: 'Update contact',
      operationId: 'patchContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      requestBody: jsonBody(ref('Contact')),
      responses: {
        '200': jsonResponse('Updated contact', ref('Contact')),
        '404': errorResponse('Contact not found'),
        '409': errorResponse('Duplicate email or external id'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Contacts'],
      summary: 'Delete contact',
      operationId: 'deleteContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      responses: {
        '200': jsonResponse('Contact deleted'),
        '404': errorResponse('Contact not found'),
        ...standardErrors,
      },
    },
  };

  // ── Automations ───────────────────────────────────────────────────────────

  paths['/api/v1/automations'] = {
    get: {
      tags: ['Automations'],
      summary: 'List automations',
      operationId: 'listAutomations',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('projectId', 'Only automations of this project'),
      ],
      responses: {
        '200': jsonResponse(
          'Paginated automations',
          pageOf(ref('AutomationSummary')),
        ),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}'] = {
    get: {
      tags: ['Automations'],
      summary: 'Get one automation version',
      operationId: 'getAutomation',
      security: sec,
      parameters: [
        automationNameParam,
        queryParam('version', 'A specific version (the latest when omitted)', {
          type: 'integer',
        }),
      ],
      responses: {
        '200': jsonResponse('The automation version', ref('Automation')),
        '404': errorResponse('Automation not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/versions'] = {
    get: {
      tags: ['Automations'],
      summary: 'List an automation’s versions',
      operationId: 'listAutomationVersions',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse('Immutable version history'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/runs'] = {
    get: {
      tags: ['Automations'],
      summary: 'List an automation’s runs',
      operationId: 'listAutomationRuns',
      security: sec,
      parameters: [automationNameParam, ...paginationParams],
      responses: {
        '200': jsonResponse(
          'Paginated runs, newest first',
          pageOf(ref('RunSummary')),
        ),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Automations'],
      summary: 'Start a run of the deployed version',
      description:
        'Answers 202 with the run’s identity rather than its result: a run ' +
        'is durable and may take minutes, so poll `GET /api/v1/runs/{runId}`. ' +
        'Starting a run needs no trigger — the API key is the entitlement. ' +
        '`mode` defaults to `live`, which requires the key holder to have ' +
        'the developer capability; a `mock` run needs only membership.',
      operationId: 'startAutomationRun',
      security: sec,
      parameters: [automationNameParam],
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            input: { type: 'object', description: 'The run’s input value' },
            mode: { type: 'string', enum: ['live', 'mock'], default: 'live' },
            version: {
              type: 'integer',
              description:
                'Run a specific version (the deployed one when omitted)',
            },
          },
        },
        false,
      ),
      responses: {
        '202': jsonResponse('Run started', {
          type: 'object',
          required: ['runId', 'version', 'name', 'mode'],
          properties: {
            runId: { type: 'string' },
            version: { type: 'integer' },
            name: { type: 'string' },
            mode: { type: 'string', enum: ['live', 'mock'] },
          },
        }),
        '403': errorResponse('A live run needs the developer capability'),
        '409': errorResponse('The automation has no deployed version'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/triggers'] = {
    get: {
      tags: ['Automations'],
      summary: 'Read the automation’s trigger',
      operationId: 'listAutomationTriggers',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'The trigger binding (never the webhook secret; `hasToken` says one exists)',
        ),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Automations'],
      summary: 'Bind what starts the automation',
      description:
        'Requires the developer capability. For a webhook trigger the ' +
        'plaintext token is returned ONCE in this response (and again only ' +
        'with `rotateToken: true`); the platform stores a hash.',
      operationId: 'setAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['schedule', 'webhook', 'event'] },
          cron: {
            type: 'string',
            description: 'Schedule trigger: cron expression',
          },
          timezone: {
            type: 'string',
            description: 'Schedule trigger: IANA timezone',
          },
          event: {
            type: 'string',
            description: 'Event trigger: the platform event name',
          },
          enabled: { type: 'boolean', default: true },
          rotateToken: {
            type: 'boolean',
            description: 'Webhook trigger: mint (and return) a fresh token',
          },
        },
      }),
      responses: {
        '200': jsonResponse('Trigger bound', {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            token: {
              type: 'string',
              description: 'Webhook trigger only, shown once',
            },
          },
        }),
        '403': errorResponse('Needs the developer capability'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Automations'],
      summary: 'Unbind the automation’s trigger',
      description:
        'Idempotent: answers 204 whether or not a trigger existed. Versions ' +
        'and run history stay. Requires the developer capability.',
      operationId: 'deleteAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '204': { description: 'Unbound (or nothing was bound)' },
        '403': errorResponse('Needs the developer capability'),
        ...standardErrors,
      },
    },
  };

  // ── Runs ──────────────────────────────────────────────────────────────────

  paths['/api/v1/runs/{runId}'] = {
    get: {
      tags: ['Runs'],
      summary: 'Get one run in full',
      operationId: 'getRun',
      security: sec,
      parameters: [pathParam('runId', 'The run ID a start call returned')],
      responses: {
        '200': jsonResponse(
          'The run: status, output, trace, effects, checkpoints',
          ref('Run'),
        ),
        '404': errorResponse('Run not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/runs/{runId}/cancel'] = {
    post: {
      tags: ['Runs'],
      summary: 'Stop a run at its next node boundary',
      description:
        'Requires the developer capability. Work a node already performed ' +
        'is not undone.',
      operationId: 'cancelRun',
      security: sec,
      parameters: [pathParam('runId', 'The run ID')],
      responses: {
        '200': jsonResponse('Cancellation result', {
          type: 'object',
          required: ['cancelled'],
          properties: { cancelled: { type: 'boolean' } },
        }),
        '403': errorResponse('Needs the developer capability'),
        '404': errorResponse('Run not found'),
        ...standardErrors,
      },
    },
  };

  // ── Threads ───────────────────────────────────────────────────────────────

  paths['/api/v1/threads'] = {
    get: {
      tags: ['Threads'],
      summary: 'List the key holder’s threads',
      operationId: 'listThreads',
      security: sec,
      parameters: paginationParams,
      responses: {
        '200': jsonResponse('Paginated threads', pageOf(ref('Thread'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Threads'],
      summary: 'Create a thread',
      operationId: 'createThread',
      security: sec,
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            title: { type: 'string' },
            agentSlug: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
        false,
      ),
      responses: {
        '201': jsonResponse('Created', {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
        '403': errorResponse('No access to the project'),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}'] = {
    get: {
      tags: ['Threads'],
      summary: 'Get a thread',
      operationId: 'getThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('The thread', ref('Thread')),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}/messages'] = {
    get: {
      tags: ['Threads'],
      summary: 'List a thread’s messages',
      operationId: 'listMessages',
      security: sec,
      parameters: [pathParam('id', 'Thread ID'), ...paginationParams],
      responses: {
        '200': jsonResponse('Paginated messages'),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Threads'],
      summary: 'Send a message and start a turn',
      description:
        'Answers 202 immediately; the turn runs in the background. Poll ' +
        '`GET /api/v1/threads/{id}/generation` until `{"status": "idle"}`, ' +
        'then read the messages. A turn that fails before producing output ' +
        'surfaces as an assistant message carrying an error — never silently.',
      operationId: 'postMessage',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['content', 'model'],
        properties: {
          content: { type: 'string' },
          model: {
            type: 'string',
            description: 'The model to answer with (never auto-selected)',
          },
          agentSlug: { type: 'string' },
          locale: { type: 'string' },
        },
      }),
      responses: {
        '202': jsonResponse('Turn accepted', {
          type: 'object',
          required: ['threadId', 'status', 'model', 'poll'],
          properties: {
            threadId: { type: 'string' },
            status: { type: 'string', enum: ['accepted'] },
            model: { type: 'string' },
            poll: { type: 'string', description: 'The generation poll URL' },
          },
        }),
        '404': errorResponse('Thread not found'),
        '409': errorResponse('Sandbox thread, or a turn is already running'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}/generation'] = {
    get: {
      tags: ['Threads'],
      summary: 'Poll the running turn',
      operationId: 'getGeneration',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse(
          '`{"status": "idle"}` when no turn is running (read the messages); otherwise the live status',
          {
            type: 'object',
            required: ['status'],
            properties: {
              status: {
                type: 'string',
                enum: [
                  'idle',
                  'queued',
                  'streaming',
                  'waiting-approval',
                  'waiting-input',
                ],
              },
              waitingOn: { type: 'string' },
              messageId: { type: 'string' },
            },
          },
        ),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
  };

  // ── Agents & skills ───────────────────────────────────────────────────────

  for (const [resource, tag] of [
    ['agents', 'Agents'],
    ['skills', 'Skills'],
  ] as const) {
    const singular = resource.slice(0, -1);
    paths[`/api/v1/${resource}`] = {
      get: {
        tags: [tag],
        summary: `List ${resource}`,
        operationId: `list${tag}`,
        security: sec,
        responses: {
          '200': jsonResponse(`The organization's ${resource}`),
          ...standardErrors,
        },
      },
    };
    paths[`/api/v1/${resource}/{slug}`] = {
      get: {
        tags: [tag],
        summary: `Get ${singular}`,
        operationId: `get${tag.slice(0, -1)}`,
        security: sec,
        parameters: [pathParam('slug', `The ${singular} slug`)],
        responses: {
          '200': jsonResponse(`The ${singular}`),
          '404': errorResponse(`No such ${singular}`),
          ...standardErrors,
        },
      },
      put: {
        tags: [tag],
        summary: `Create or replace ${singular}`,
        operationId: `save${tag.slice(0, -1)}`,
        security: sec,
        parameters: [pathParam('slug', `The ${singular} slug`)],
        requestBody: jsonBody({ type: 'object' }),
        responses: {
          '200': jsonResponse(`The saved ${singular}`),
          '403': errorResponse('Not editable with this key'),
          ...standardErrors,
        },
      },
      delete: {
        tags: [tag],
        summary: `Delete ${singular}`,
        operationId: `delete${tag.slice(0, -1)}`,
        security: sec,
        parameters: [pathParam('slug', `The ${singular} slug`)],
        responses: {
          '204': { description: 'Deleted' },
          '403': errorResponse('Not deletable with this key'),
          '404': errorResponse(`No such ${singular}`),
          ...standardErrors,
        },
      },
    };
  }

  // ── Knowledge ─────────────────────────────────────────────────────────────

  paths['/api/v1/knowledge-entries'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'List knowledge entries',
      operationId: 'listKnowledgeEntries',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('status', '`active` (default) or `superseded`'),
      ],
      responses: {
        '200': jsonResponse('Paginated entries'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Knowledge'],
      summary: 'Create a knowledge entry',
      operationId: 'createKnowledgeEntry',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['topic', 'content'],
        properties: {
          topic: { type: 'string' },
          content: { type: 'string' },
        },
      }),
      responses: {
        '201': jsonResponse('Created', {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
        '409': errorResponse('An active entry with this topic exists'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/knowledge-entries/{id}'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'Get a knowledge entry',
      operationId: 'getKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '200': jsonResponse('The entry'),
        '404': errorResponse('Entry not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Knowledge'],
      summary: 'Supersede a knowledge entry',
      description:
        'Entries are immutable: an update writes a NEW row and answers its ' +
        'id; the old row becomes `superseded`.',
      operationId: 'updateKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      requestBody: jsonBody({
        type: 'object',
        properties: {
          topic: { type: 'string' },
          content: { type: 'string' },
        },
      }),
      responses: {
        '200': jsonResponse('The NEW row', {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
        '404': errorResponse('Entry not found'),
        '409': errorResponse('Entry is not active'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Knowledge'],
      summary: 'Delete a knowledge entry',
      operationId: 'deleteKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '204': { description: 'Deleted' },
        '404': errorResponse('Entry not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/knowledge/search'] = {
    post: {
      tags: ['Knowledge'],
      summary: 'Semantic search over the organization’s knowledge',
      operationId: 'searchKnowledge',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          corpus: { type: 'string' },
          limit: { type: 'integer' },
          minSimilarity: { type: 'number' },
        },
      }),
      responses: {
        '200': jsonResponse('Hits and diagnostics', {
          type: 'object',
          required: ['hits'],
          properties: {
            hits: { type: 'array', items: { type: 'object' } },
            diagnostics: { type: 'object' },
          },
        }),
        '409': errorResponse('No embedding model is configured'),
        ...standardErrors,
      },
    },
  };

  // ── MCP ───────────────────────────────────────────────────────────────────

  paths['/api/v1/mcp'] = {
    post: {
      tags: ['MCP'],
      summary: 'The platform MCP endpoint',
      description:
        'JSON-RPC over HTTP (MCP protocol 2025-03-26; JSON responses only, ' +
        'no SSE; one message per request). Authenticate with the same ' +
        'Bearer org API key as the REST API. Call `tools/list` for the tool ' +
        'inventory — automation authoring, run and trigger management, and ' +
        'the organization’s capability surface — and the `get_docs` tool for ' +
        'the in-band authoring reference. GET answers 405. See the MCP ' +
        'endpoint page in the developer docs for the full tour.',
      operationId: 'mcp',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        description: 'A single JSON-RPC 2.0 message',
      }),
      responses: {
        '200': jsonResponse('The JSON-RPC response'),
        ...standardErrors,
      },
    },
  };

  // ── Inbound automation webhook ────────────────────────────────────────────

  paths['/api/automations/webhook/{token}'] = {
    post: {
      tags: ['Automations'],
      summary: 'Fire a webhook trigger',
      description:
        'The URL token IS the credential (minted by `PUT /api/v1/automations/' +
        '{name}/triggers`, shown once, stored hashed). The request body ' +
        '(≤256 KB) becomes the run’s input.',
      operationId: 'fireAutomationWebhook',
      security: [],
      parameters: [pathParam('token', 'The webhook token')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: {
        '202': jsonResponse('Run started', {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string' } },
        }),
        '404': errorResponse('Unknown or disabled token'),
        '409': errorResponse('The automation has no deployed version'),
        '413': errorResponse('Body exceeds 256 KB'),
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Tale Platform API',
      version: '1.1.0',
      description: `
REST access to a Tale deployment: knowledge resources, automations and their
runs, chat threads, agents, and skills — plus an MCP endpoint exposing the
same platform to MCP clients.

## Authentication

Every request carries an organization API key (create one in
Settings → API):

\`\`\`
Authorization: Bearer tale_...
\`\`\`

## Errors

Non-2xx responses carry a flat envelope: \`{"error": "<message>"}\`.

## Pagination

List endpoints take \`cursor\` + \`limit\` and answer
\`{page, isDone, continueCursor}\`; pass \`continueCursor\` back as \`cursor\`.

## Rate limits

Reads and CRUD share one bucket (120/min, burst 200). Starting an automation
run and sending a chat message share a tighter one (20/min, burst 40).

## Quick start

\`\`\`bash
# 1. What automations does the org have?
curl -H "Authorization: Bearer tale_..." \\
  https://your-instance.com/api/v1/automations

# 2. Start a run of the deployed version
curl -X POST -H "Authorization: Bearer tale_..." \\
  -H "Content-Type: application/json" -d '{"input": {}}' \\
  https://your-instance.com/api/v1/automations/billing__dunning/runs

# 3. Poll it
curl -H "Authorization: Bearer tale_..." \\
  https://your-instance.com/api/v1/runs/<runId>
\`\`\`
`.trim(),
    },
    servers: [{ url: '', description: 'Same origin' }],
    security: sec,
    tags: [
      { name: 'Documents', description: 'Documents in the knowledge base.' },
      { name: 'Websites', description: 'Crawled website sources.' },
      { name: 'Products', description: 'Product catalog entries.' },
      { name: 'Contacts', description: 'Contact records.' },
      {
        name: 'Automations',
        description: 'Versioned automations, their runs and triggers.',
      },
      { name: 'Runs', description: 'Durable automation runs.' },
      { name: 'Threads', description: 'Chat threads of the key holder.' },
      { name: 'Agents', description: 'The organization’s agents.' },
      { name: 'Skills', description: 'The organization’s skills.' },
      {
        name: 'Knowledge',
        description: 'Knowledge entries and semantic search.',
      },
      {
        name: 'MCP',
        description: 'The platform MCP endpoint (JSON-RPC over HTTP).',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An organization API key. Create one in Settings → API.',
        },
      },
      schemas: {
        ...(legacySchemas as Record<string, Json>),
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string', description: 'What went wrong' },
          },
        },
        Contact: {
          type: 'object',
          description:
            'A contact record. See the API reference for the full field set.',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            source: { type: 'string' },
            locale: { type: 'string' },
          },
          additionalProperties: true,
        },
        AutomationSummary: {
          type: 'object',
          required: ['name', 'latest'],
          properties: {
            name: { type: 'string', description: 'The real `/`-slug' },
            latest: { type: 'integer' },
            deployedVersion: { type: 'integer' },
          },
        },
        Automation: {
          type: 'object',
          required: ['name', 'version', 'document'],
          properties: {
            name: { type: 'string' },
            version: { type: 'integer' },
            document: {
              type: 'object',
              description:
                'The authored content (nodes and acceptance tests). The MCP ' +
                '`get_docs` tool is the grammar reference.',
            },
            message: { type: 'string' },
            testsPassed: { type: 'boolean' },
            deployedVersion: { type: 'integer' },
            createdBy: { type: 'string' },
            createdAt: { type: 'number' },
          },
        },
        RunSummary: {
          type: 'object',
          required: ['runId', 'status', 'mode', 'startedAt'],
          properties: {
            runId: { type: 'string' },
            status: {
              type: 'string',
              enum: [
                'queued',
                'running',
                'waiting',
                'success',
                'failed',
                'cancelled',
              ],
            },
            mode: { type: 'string', enum: ['mock', 'live'] },
            version: { type: 'integer' },
            startedAt: { type: 'number' },
            finishedAt: { type: 'number' },
          },
        },
        Run: {
          type: 'object',
          description:
            'A run in full: summary fields plus input, output, trace, ' +
            'effects, and per-node checkpoints.',
          allOf: [{ $ref: '#/components/schemas/RunSummary' }],
          additionalProperties: true,
        },
        Thread: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            kind: { type: 'string' },
            agentSlug: { type: 'string' },
            projectId: { type: 'string' },
            archived: { type: 'boolean' },
            generating: { type: 'boolean' },
            createdAt: { type: 'number' },
            updatedAt: { type: 'number' },
          },
          additionalProperties: true,
        },
      },
    },
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main() {
  const outputPath = join(platformDir, 'public', 'openapi.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(buildSpec(), null, 2), 'utf-8');
  console.log(`OpenAPI spec written to ${outputPath}`);
}

main();
