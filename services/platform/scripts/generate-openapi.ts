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

/** The tenant header the write-capable project endpoints demand of
 * multi-org keys. */
const orgSlugHeaderParam = {
  name: 'X-Organization-Slug',
  in: 'header' as const,
  required: false,
  schema: { type: 'string' },
  description:
    'The organization to operate on. STRICTLY REQUIRED when the key holder ' +
    'belongs to more than one organization — without it such requests are ' +
    'refused with 400 (the last-active-org fallback is never used here). ' +
    'Single-organization keys may omit it.',
};

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

  // ── Projects ──────────────────────────────────────────────────────────────

  paths['/api/v1/projects'] = {
    get: {
      tags: ['Projects'],
      summary: 'Look up a project by external item id',
      description:
        'A lookup door, not a list-all: `externalItemId` is REQUIRED (400 ' +
        'without it). Answers at most one project — the key is unique per ' +
        'organization. A project the key holder cannot see answers the same ' +
        'empty list as no match. The row carries `archivedAt` when the match ' +
        'is archived, so callers can detect an archived project holding the ' +
        'key. Shares the general REST bucket (120/min; REST buckets are ' +
        'IP-keyed pre-auth, so a NAT’d worker fleet shares one budget).',
      operationId: 'lookupProjects',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        {
          ...queryParam(
            'externalItemId',
            'The caller-owned external key the project was created with',
          ),
          required: true,
        },
      ],
      responses: {
        '200': jsonResponse('Zero or one matching project', {
          type: 'object',
          required: ['projects'],
          properties: {
            projects: { type: 'array', items: ref('Project') },
          },
        }),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      description:
        'Requires the org editor role. `externalItemId` is an opaque ' +
        'caller-owned key, stored trimmed, unique per organization ' +
        'regardless of lifecycle — a conflict against an archived project ' +
        'is still a 409. A blank or over-long value is a 400. `key` (the ' +
        'task-identifier prefix) is derived from the name when omitted; a ' +
        'derived key that collides gets a numeric suffix, and a name no key ' +
        'can be derived from creates the project keyless — only an EXPLICIT ' +
        '`key` conflict answers 409.',
      operationId: 'createProject',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 80 },
          externalItemId: { type: 'string', maxLength: 256 },
          key: {
            type: 'string',
            description:
              'Immutable 2-6 char task-key prefix. Omitted: derived from ' +
              'the name, suffixed on collision, keyless when underivable. ' +
              'Explicit: a collision is a 409.',
          },
          description: { type: 'string', maxLength: 500 },
        },
      }),
      responses: {
        '201': jsonResponse('Created project', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '403': errorResponse('The key holder is not an org editor'),
        '409': errorResponse('Duplicate externalItemId or project key'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}'] = {
    get: {
      tags: ['Projects'],
      summary: 'Get a project',
      description:
        'Answers an opaque 404 for a project that is cross-organization, ' +
        'invisible to the key holder, or does not exist — the three are ' +
        'indistinguishable.',
      operationId: 'getProject',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      responses: {
        '200': jsonResponse('The project', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/folders'] = {
    get: {
      tags: ['Projects'],
      summary: 'List the project’s root folders',
      description:
        'Top-level folders only, NOT paginated — a project holds a handful ' +
        'of period folders, not an unbounded tree.',
      operationId: 'listProjectFolders',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      responses: {
        '200': jsonResponse('The root folders', {
          type: 'object',
          required: ['folders'],
          properties: {
            folders: { type: 'array', items: ref('ProjectFolder') },
          },
        }),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Get or create a folder',
      description:
        'GET-OR-CREATE semantics: an exact-name match under the same parent ' +
        'answers 200 with `created: false`; otherwise the folder is created ' +
        'and answered 201 with `created: true`. `parentId` must name a ' +
        'folder of THIS project (an opaque 404 otherwise); omit it for a ' +
        'root folder. Requires the org editor role and project edit access. ' +
        'Charged against the general REST bucket (120/min) and the per-org ' +
        '`folder:mutate` budget the in-app folder actions share.',
      operationId: 'getOrCreateProjectFolder',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 255 },
          parentId: {
            type: 'string',
            description: 'Parent folder id (a folder of this project)',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The existing folder', ref('ProjectFolderResult')),
        '201': jsonResponse('The created folder', ref('ProjectFolderResult')),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project or parent folder not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/uploads'] = {
    post: {
      tags: ['Projects'],
      summary: 'Mint an upload handoff',
      description:
        'Answers where to send the bytes: `method: "PUT"` is a presigned ' +
        'URL for the organization’s own bucket (bind the returned `s3Ref` ' +
        'afterwards) — a declared `contentType` is signed into the URL, so ' +
        'the PUT must carry that exact `Content-Type` header (omit ' +
        '`contentType` and the PUT has no header requirement); ' +
        '`method: "POST"` targets platform storage and answers ' +
        '`{"storageId": …}` — bind that id. The `uploadId` is a single-use ' +
        'intent valid until `expiresAt` (60 minutes); complete the upload ' +
        'with `POST /api/v1/projects/{id}/files`. Requires the org editor ' +
        'role and project edit access. Uses the upload lane bucket ' +
        '(240/min — one logical upload is several calls; IP-keyed, so a ' +
        'NAT’d worker fleet shares the budget).',
      operationId: 'createProjectUpload',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            contentType: { type: 'string' },
          },
        },
        false,
      ),
      responses: {
        '200': jsonResponse('The upload handoff', ref('ProjectUploadHandoff')),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/files/{documentId}/content'] = {
    get: {
      tags: ['Projects'],
      summary: 'Download a project file',
      description:
        'The result lane: fetch the bytes of a file in the project — ' +
        'including what an automation filed back (a prepared return, a ' +
        'report). A Convex-stored blob streams in the response with its ' +
        'content type and an attachment filename; on an organization with ' +
        'its own object storage the answer is a **302** to a short-lived ' +
        'presigned URL, so follow redirects. Visibility is the minting ' +
        'user’s; a cross-project, cross-organization, trashed, or absent ' +
        'file answers the same opaque 404.',
      operationId: 'downloadProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '200': {
          description: 'The file bytes (Convex-stored blob)',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        '302': {
          description:
            'Redirect to a short-lived presigned URL (organization object storage)',
        },
        '404': errorResponse('File not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/files'] = {
    get: {
      tags: ['Projects'],
      summary: 'List the project’s files',
      description:
        'Paginated (`cursor` + `limit`, answering `{files, cursor?}` — no ' +
        '`cursor` in the response means the listing is complete). ' +
        '`folderId` narrows to one folder of this project. Project files ' +
        'never appear in `GET /api/v1/documents` — that is the knowledge ' +
        'hub’s surface.',
      operationId: 'listProjectFiles',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        queryParam('folderId', 'Only files inside this project folder'),
        ...paginationParams,
      ],
      responses: {
        '200': jsonResponse('The files', {
          type: 'object',
          required: ['files'],
          properties: {
            files: { type: 'array', items: ref('ProjectFile') },
            cursor: {
              type: 'string',
              description: 'Present while more pages remain',
            },
          },
        }),
        '404': errorResponse('Project or folder not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Bind an uploaded blob as a project file',
      description:
        'Consumes the single-use `uploadId` minted by `POST …/uploads` and ' +
        'creates the document. `fileId` is the `s3Ref` for a PUT handoff, or ' +
        'the `storageId` the platform-storage POST answered. `folderId` is ' +
        'REQUIRED and must belong to this project. `skipRagIndexing` ' +
        'DEFAULTS TO TRUE — project ledger files are working material, not ' +
        'organization knowledge; pass `false` explicitly to index the file ' +
        'into the knowledge corpus. Upload policy applies (authoritative ' +
        'size cap → 413, MIME allowlist → 415). Uses the upload lane bucket ' +
        '(240/min, IP-keyed).',
      operationId: 'bindProjectFile',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['uploadId', 'fileId', 'folderId', 'fileName'],
        properties: {
          uploadId: { type: 'string' },
          fileId: { type: 'string' },
          folderId: { type: 'string' },
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          skipRagIndexing: { type: 'boolean', default: true },
        },
      }),
      responses: {
        '201': jsonResponse('The bound file', {
          type: 'object',
          required: ['file'],
          properties: {
            file: {
              type: 'object',
              required: ['id', 'fileName', 'folderId', 'projectId'],
              properties: {
                id: { type: 'string' },
                fileName: { type: 'string' },
                folderId: { type: 'string' },
                projectId: { type: 'string' },
              },
            },
          },
        }),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project or folder not found'),
        '413': errorResponse('File exceeds the size cap'),
        '415': errorResponse('Unsupported file type'),
        ...standardErrors,
        // Richer than the standard 400: the handshake refusals land here too.
        '400': errorResponse(
          'Malformed body, or the upload intent is unknown, expired, ' +
            'already consumed, or does not match `fileId`',
        ),
      },
    },
  };

  // ── Tasks ─────────────────────────────────────────────────────────────────

  paths['/api/v1/tasks'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Create a task from an external ref (idempotent)',
      description:
        'Materializes an external item as a task of one project, keyed by ' +
        '`(projectId, externalSystem, externalId)`: the first call creates ' +
        '(201, `created: true`), any repeat answers the SAME task (200, ' +
        '`created: false`) instead of a duplicate — safe for a worker that ' +
        'retries after a crash. `projectId` is REQUIRED: this door never ' +
        'falls back to the org-wide project, and the project must exist AND ' +
        'be visible to the key’s minting user (an opaque 404 otherwise). ' +
        '`externalId` is a caller-owned opaque key the platform never ' +
        'interprets; `externalUrl` is stored verbatim. The task is created ' +
        'by the minting user; over-long titles are truncated to the board ' +
        'cap rather than refused. When `runWorkflowSlug` names a deployed ' +
        'automation, a NEWLY created task also schedules that workflow on ' +
        'itself — the response then carries `executionId: null` (the start ' +
        'is scheduled, no run identity yet). To recover the run identity, ' +
        'call `POST /api/v1/tasks/{id}/start` ONCE — it answers ' +
        '`already_running` with the live run’s executionId while the run is ' +
        'in flight — then poll `GET /api/v1/runs/{runId}`. Do NOT poll ' +
        '`/start` itself: once the run settles, another call starts a fresh ' +
        'run. Skipped on an idempotent re-pick. Shares the general REST ' +
        'bucket (120/min, IP-keyed).',
      operationId: 'createTask',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['projectId', 'externalSystem', 'externalId', 'title'],
        properties: {
          projectId: {
            type: 'string',
            description: 'The destination project — required, never defaulted',
          },
          externalSystem: {
            type: 'string',
            maxLength: 100,
            description: 'The external system the ref belongs to',
          },
          externalId: {
            type: 'string',
            maxLength: 500,
            description:
              'Caller-owned natural key, opaque to the platform; the ' +
              'idempotency key within the project (per externalSystem)',
          },
          title: { type: 'string', maxLength: 2000 },
          description: { type: 'string', maxLength: 20000 },
          labels: {
            type: 'array',
            items: { type: 'string', maxLength: 50 },
            maxItems: 50,
            description:
              'Label names, resolved against (and added to) the project’s ' +
              'label catalog',
          },
          externalUrl: {
            type: 'string',
            maxLength: 2048,
            description: 'Generic external reference, stored verbatim',
          },
          runWorkflowSlug: {
            type: 'string',
            maxLength: 200,
            description:
              'Deployed automation to schedule on the task when (and only ' +
              'when) this call CREATES it',
          },
          automationSlug: {
            type: 'string',
            maxLength: 200,
            description:
              'Attribute the task to this automation WITHOUT starting ' +
              'anything: it becomes the assignee, which the task modal’s ' +
              'work panel (Start, run progress, operator questions) keys ' +
              'on. Send it when creating tasks an automation will operate. ' +
              'A re-pick fills a missing attribution but never overwrites ' +
              'an existing assignee.',
          },
        },
      }),
      responses: {
        '201': jsonResponse('Created', ref('TaskUpsertResult')),
        '200': jsonResponse(
          'The task already existed (idempotent re-pick)',
          ref('TaskUpsertResult'),
        ),
        '404': errorResponse('Project not found (or not visible to the key)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}/comments'] = {
    get: {
      tags: ['Tasks'],
      summary: 'List the task’s comments',
      description:
        'The discussion read lane: what automations reported back (prepared ' +
        'figures, operator questions, setup summaries) and what people ' +
        'replied — chronological, capped at the same bound the app renders. ' +
        '`authorType` separates `user` and `agent` voices. Visibility is ' +
        'the minting user’s, like every task read.',
      operationId: 'listTaskComments',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      responses: {
        '200': jsonResponse('The discussion, oldest first', {
          type: 'object',
          required: ['comments'],
          properties: {
            comments: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'authorType', 'authorId', 'body', 'createdAt'],
                properties: {
                  id: { type: 'string' },
                  authorType: { type: 'string', enum: ['user', 'agent'] },
                  authorId: { type: 'string' },
                  body: { type: 'string' },
                  createdAt: { type: 'number' },
                  editedAt: { type: 'number' },
                },
              },
            },
          },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}'] = {
    get: {
      tags: ['Tasks'],
      summary: 'Get a task',
      description:
        'The task’s state for a polling worker. Visibility is the minting ' +
        'user’s (a task inherits its project’s access): a cross-organization ' +
        'id, an invisible task, and a nonexistent one all answer the same ' +
        'opaque 404. The task row carries NO live-run linkage — to follow a ' +
        'workflow run, keep the `executionId` answered by `POST ' +
        '/api/v1/tasks/{id}/start` and poll `GET /api/v1/runs/{runId}`.',
      operationId: 'getTask',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      responses: {
        '200': jsonResponse('The task', {
          type: 'object',
          required: ['task'],
          properties: { task: ref('Task') },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}/start'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Start a deployed workflow on the task',
      description:
        'Starts a fresh, subject-linked run of `workflowSlug` carrying the ' +
        'task as its input — the REST twin of the task board’s Start. RBAC ' +
        'is deliberately the session action’s: org membership plus the ' +
        'task’s READ visibility, NOT the developer gate `POST ' +
        '/api/v1/automations/{name}/runs` applies — that endpoint starts a ' +
        'run with arbitrary input, while this one is task-subject-bound ' +
        '(its input IS the task), which narrows the blast radius; deploying ' +
        'the workflow was the privileged act. The run is attributed ' +
        '`api-key:<userId>` in the run log, so machine starts stay ' +
        'distinguishable from human UI starts. Answers the session shape: ' +
        '`started: true` with the new run’s `executionId` (poll `GET ' +
        '/api/v1/runs/{runId}`); `already_running` with the in-flight run’s ' +
        'id instead of racing a duplicate over the same task; `not_started` ' +
        'when the slug names no deployed automation (or the start failed) — ' +
        'the task itself is untouched either way. Work-starting lane: ' +
        'charged against the execute bucket (20/min) on top of the general ' +
        'one (120/min); both IP-keyed.',
      operationId: 'startTaskWorkflow',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['workflowSlug'],
        properties: {
          workflowSlug: {
            type: 'string',
            maxLength: 200,
            description: 'The deployed automation to run on this task',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The start outcome', {
          type: 'object',
          required: ['started', 'executionId'],
          properties: {
            started: { type: 'boolean' },
            reason: {
              type: 'string',
              enum: ['already_running', 'not_started'],
              description: 'Present only when `started` is false',
            },
            executionId: {
              type: 'string',
              nullable: true,
              description:
                'The run to poll via GET /api/v1/runs/{runId} — the new ' +
                'run’s id, the in-flight one’s for `already_running`, null ' +
                'for `not_started`',
            },
          },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}/comments'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Comment on the task as the key’s user',
      description:
        'Posts into the task’s discussion AS THE MINTING USER (author and ' +
        'actor type `user`) — indistinguishable from the same person ' +
        'commenting in the app, @mention behaviour included. Commenting is ' +
        'a READ-level action: any member who can see the task may post. ' +
        'The body is capped at 10000 characters and charged against the ' +
        'same per-user `task:comment` budget as in-app comments (429 with ' +
        'Retry-After beyond it).',
      operationId: 'addTaskComment',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['body'],
        properties: {
          body: {
            type: 'string',
            maxLength: 10000,
            description: 'The comment text',
          },
        },
      }),
      responses: {
        '201': jsonResponse('The posted comment', {
          type: 'object',
          required: ['comment'],
          properties: {
            comment: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        }),
        '404': errorResponse('Task not found'),
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

  paths['/api/v1/automations/{name}/projects'] = {
    post: {
      tags: ['Automations'],
      summary: 'Bind the automation to a project',
      description:
        'Idempotently adds ONE project to the automation’s binding set — ' +
        'the machine door’s install step, so a worker that just created a ' +
        'client project can put the automation on it without a human. The ' +
        'binding SET is the scope: an automation with no bindings is ' +
        'org-level (every project sees it); one with bindings runs only in ' +
        'those projects. Requires the developer capability (the same gate ' +
        'as the session binding panel), and a key whose user belongs to ' +
        'several organizations must send `X-Organization-Slug`. The target ' +
        'project must be visible to the key’s minting user — an invisible ' +
        'or foreign project answers the same 404 as an absent one. Answers ' +
        '201 when the binding was added, 200 when it already existed. ' +
        'Unbinding stays a dashboard operation.',
      operationId: 'bindAutomationProject',
      security: sec,
      parameters: [automationNameParam, orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'The project to bind' },
        },
      }),
      responses: {
        '201': jsonResponse('Binding added', {
          type: 'object',
          required: ['name', 'added'],
          properties: {
            name: { type: 'string' },
            added: { type: 'boolean', enum: [true] },
          },
        }),
        '200': jsonResponse('Binding already existed', {
          type: 'object',
          required: ['name', 'added'],
          properties: {
            name: { type: 'string' },
            added: { type: 'boolean', enum: [false] },
          },
        }),
        '403': errorResponse('The key holder lacks the developer capability'),
        '404': errorResponse(
          'Automation or project not found (or not visible to the key)',
        ),
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
        name: 'Projects',
        description:
          'Projects, their folders, and their files — the machine door for ' +
          'external systems that mirror client work into the platform. ' +
          'Multi-org keys must send X-Organization-Slug on every call.',
      },
      {
        name: 'Tasks',
        description:
          'Tasks on the project boards — the machine door for external ' +
          'workers that materialize items as tasks, start their workflows, ' +
          'and report back. Multi-org keys must send X-Organization-Slug ' +
          'on every call.',
      },
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
        Project: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            key: {
              type: 'string',
              description: 'Immutable task-identifier prefix',
            },
            description: { type: 'string' },
            externalItemId: {
              type: 'string',
              description: 'Caller-owned external key, unique per organization',
            },
            archivedAt: {
              type: 'number',
              description:
                'Present (epoch ms) when the project is archived — the ' +
                'archived marker for lookups',
            },
          },
        },
        ProjectFolder: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
        ProjectFolderResult: {
          type: 'object',
          required: ['folder', 'created'],
          properties: {
            folder: { $ref: '#/components/schemas/ProjectFolder' },
            created: {
              type: 'boolean',
              description:
                'false when an exact-name sibling already existed (200)',
            },
          },
        },
        ProjectUploadHandoff: {
          type: 'object',
          required: ['uploadId', 'url', 'method', 'expiresAt'],
          properties: {
            uploadId: {
              type: 'string',
              description: 'Single-use intent to present at the bind step',
            },
            url: { type: 'string', description: 'Where to send the bytes' },
            method: { type: 'string', enum: ['POST', 'PUT'] },
            s3Ref: {
              type: 'string',
              description:
                'PUT lane only: the blob reference to bind as `fileId`',
            },
            expiresAt: {
              type: 'number',
              description: 'Epoch ms; the intent dies of old age after this',
            },
          },
        },
        ProjectFile: {
          type: 'object',
          required: ['id', 'fileName', 'createdAt'],
          properties: {
            id: { type: 'string' },
            fileName: { type: 'string' },
            folderId: { type: 'string' },
            createdAt: { type: 'number' },
            size: { type: 'number', description: 'Bytes, when known' },
            ragStatus: {
              type: 'string',
              description:
                'Knowledge-index status; absent means not indexed (the ' +
                'default for this door)',
            },
          },
        },
        Task: {
          type: 'object',
          required: [
            'id',
            'title',
            'status',
            'projectId',
            'labels',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: {
              type: 'string',
              enum: [
                'backlog',
                'todo',
                'in_progress',
                'in_review',
                'done',
                'cancelled',
              ],
            },
            projectId: { type: 'string' },
            externalSystem: { type: 'string' },
            externalId: {
              type: 'string',
              description: 'The caller-owned natural key, verbatim',
            },
            externalUrl: { type: 'string' },
            description: { type: 'string' },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Resolved label names',
            },
            createdAt: { type: 'number' },
            updatedAt: { type: 'number' },
          },
        },
        TaskUpsertResult: {
          type: 'object',
          required: ['task'],
          properties: {
            task: {
              type: 'object',
              required: ['id', 'created'],
              properties: {
                id: { type: 'string' },
                created: {
                  type: 'boolean',
                  description: 'false on an idempotent re-pick (200)',
                },
              },
            },
            executionId: {
              type: 'string',
              nullable: true,
              description:
                'Present (as null) only when a workflow start was SCHEDULED ' +
                'for a newly created task — no run identity exists yet',
            },
          },
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
