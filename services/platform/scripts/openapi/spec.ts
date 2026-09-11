/**
 * The OpenAPI document behind the Swagger UI at `/docs` — built statically,
 * with no side effects, so `scripts/openapi/spec.test.ts` can hold it against
 * the `/api/v1` router (every path+method here is a registered route and
 * vice versa) and against the handlers' real response shapes. When you add,
 * move, or remove a `/api/v1` route, or change what one answers, this file
 * changes in the same commit; `bun run generate:openapi` rewrites
 * `public/openapi.json` from it.
 *
 * Every description below is the handler's contract as implemented (the
 * backend/rest/* adapters over the domain services), not an aspiration.
 */

import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_MODEL_MAX,
  projectAgentInputSchema,
} from '@tale/shared/schemas/projects';
// ── Small builders ───────────────────────────────────────────────────────────
import { z } from 'zod';

import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '../../backend/core/knowledge_entries/constants.ts';
import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
} from '../../backend/core/products/field_limits.ts';
import {
  TASK_LABEL_CHARS_MAX,
  TASK_TITLE_MAX,
} from '../../backend/core/tasks/helpers.ts';
import { SCAN_INTERVAL_VALUES } from '../../backend/core/websites/types.ts';
import {
  CONTACT_EMAIL_MAX,
  CONTACT_EXTERNAL_ID_MAX,
  CONTACT_LOCALE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_NOTES_MAX,
  CONTACT_PHONE_MAX,
  CONTACT_TAG_MAX,
  CONTACT_TAGS_MAX,
} from '../../backend/domains/contacts/input-schema.ts';
import {
  PRODUCT_EXTERNAL_ID_MAX,
  PRODUCT_TAG_MAX,
  PRODUCT_TAGS_MAX,
} from '../../backend/domains/products/input-schema.ts';
import { PRODUCT_STATUSES } from '../../backend/domains/products/service.ts';
import { AGENT_TOOL_GRANT_NAMES } from '../../backend/domains/projects/agent-equipment.ts';
import { REST_ERROR_CODES } from '../../backend/rest/error-codes.ts';
import { CHAT_ERROR_CODES } from '../../lib/shared/chat-errors.ts';
import {
  apiDeliveryFailureSchema,
  apiSnapshotSchema,
} from '../../lib/shared/conversations/api-sync.ts';
import { dataSourceSchema } from '../../lib/shared/schemas/common.ts';

export type Json = Record<string, unknown>;

const sec = [{ bearerAuth: [] }];
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

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
  '429': errorResponse('Rate limit exceeded (Retry-After names the wait)'),
};

function jsonBody(schema: Json, required = true) {
  return { required, content: { 'application/json': { schema } } };
}

function jsonResponse(description: string, schema?: Json) {
  if (!schema) return { description };
  return { description, content: { 'application/json': { schema } } };
}

/** A `201 {id}` answer — what every create route in the knowledge families
 * returns (read the resource back with its GET). */
function createdId(description: string) {
  return jsonResponse(description, {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  });
}

function noContent(description: string) {
  return { description };
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

/** `cursor` + `limit` for the keyset-paginated families. `cursorField`
 * names the response field the cursor comes back in — `continueCursor` for
 * the `{page, isDone, continueCursor}` envelope, `cursor` for the project
 * files listing — so the parameter never points at a field its own
 * response does not carry. */
function paginationParams(
  max: number,
  fallback: number,
  cursorField: 'continueCursor' | 'cursor' = 'continueCursor',
) {
  return [
    queryParam(
      'cursor',
      `The previous page’s \`${cursorField}\`, unchanged — opaque; omit for the first page. A value this list did not answer is refused with 400 \`INVALID_CURSOR\` rather than read as the first page`,
    ),
    {
      ...queryParam(
        'limit',
        `Page size, 1..${max} (default ${fallback}; out-of-range numbers are clamped, a value that is not a number answers 400 \`INVALID_LIMIT\`)`,
      ),
      schema: { type: 'integer', minimum: 1, maximum: max, default: fallback },
    },
  ];
}

/** A paginated envelope: `{page: [...], isDone, continueCursor}`. */
function pageOf(item: Json): Json {
  return {
    type: 'object',
    required: ['page', 'isDone', 'continueCursor'],
    properties: {
      page: { type: 'array', items: item },
      isDone: { type: 'boolean' },
      continueCursor: {
        type: 'string',
        description:
          'Pass back as `cursor` for the next page; empty when `isDone`',
      },
    },
  };
}

/** A named-array envelope: `{<name>: [...]}` — a bounded window or a
 * complete set, never a cursor walk. */
function listOf(name: string, item: Json, extra: Json = {}): Json {
  return {
    type: 'object',
    required: [name, ...Object.keys(extra)],
    properties: { [name]: { type: 'array', items: item }, ...extra },
  };
}

const nullable = (schema: Json): Json => ({ ...schema, nullable: true });
const str: Json = { type: 'string' };
const num: Json = { type: 'number' };
const int: Json = { type: 'integer' };
const bool: Json = { type: 'boolean' };
const obj: Json = { type: 'object', additionalProperties: true };
const strArray: Json = { type: 'array', items: str };
/** A number whose magnitude JSON can carry exactly: beyond 2^53 − 1 the
 * parser rounds it before any schema sees it, so the door refuses it. */
const safeNumber: Json = {
  type: 'number',
  minimum: -Number.MAX_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
};

/** The project-agent body: the shared zod schema rendered to JSON Schema,
 * with the closed tool-grant vocabulary the catalog carries — a name
 * outside it is refused (`PROJECT_AGENT_TOOL_UNKNOWN`), never dropped. */
const projectAgentInputSpec: Json = (() => {
  const rendered = z.toJSONSchema(projectAgentInputSchema.strict(), {
    target: 'openapi-3.0',
    io: 'input',
  });
  const properties =
    typeof rendered.properties === 'object' && rendered.properties !== null
      ? { ...rendered.properties }
      : {};
  properties.tools = {
    type: 'array',
    maxItems: PROJECT_AGENT_BINDINGS_MAX,
    items: { type: 'string', enum: [...AGENT_TOOL_GRANT_NAMES] },
    description:
      'Workspace tool grants, from the catalog above; omitted resets to none',
  };
  properties.model = {
    type: 'string',
    minLength: 1,
    maxLength: PROJECT_AGENT_MODEL_MAX,
    description:
      'A model id `GET /api/v1/models` lists for this organization — with ' +
      '`modelProvider`, the exact (provider, model) pair',
  };
  properties.modelProvider = {
    type: 'string',
    maxLength: PROJECT_AGENT_MODEL_MAX,
    description:
      'The provider slug serving `model`, from `GET /api/v1/models`; ' +
      'omitted, any provider serving the id is accepted',
  };
  properties.skills = {
    type: 'array',
    maxItems: PROJECT_AGENT_BINDINGS_MAX,
    items: { type: 'string' },
    description:
      'Skill slugs the project can see (`GET /api/v1/skills`); an unknown ' +
      'slug is refused',
  };
  properties.connectors = {
    type: 'array',
    maxItems: PROJECT_AGENT_BINDINGS_MAX,
    items: { type: 'string' },
    description:
      'Connector slugs the organization has connected; an unknown or ' +
      'unconnected one is refused',
  };
  return {
    ...rendered,
    properties,
    description:
      'Full project-agent configuration. name, harness, model, skills and ' +
      'connectors are required. Harness must support project-agent ' +
      'execution (Cursor is excluded). Every equipment field is checked ' +
      'against what this organization can serve — the model pair against ' +
      '`GET /api/v1/models`, skills against `GET /api/v1/skills`, ' +
      'connectors against the connected set, tools against the grant ' +
      'catalog — and refused by name otherwise. Omitted ' +
      'modelProvider/instructions reset to null; omitted tools/secrets reset ' +
      'to empty arrays. secrets contains organization secret NAMES, never ' +
      'values; only organization admins may change these grants. Unknown ' +
      'secret names are pruned.',
  };
})();

/** The contact write fields (`domains/contacts/input-schema.ts`), shared
 * by the create body and the patch body. */
const contactInputProperties: Json = {
  name: { ...str, maxLength: CONTACT_NAME_MAX },
  email: { ...str, format: 'email', maxLength: CONTACT_EMAIL_MAX },
  phone: { ...str, maxLength: CONTACT_PHONE_MAX },
  source: {
    type: 'string',
    enum: [...dataSourceSchema.options],
    description:
      'Where the contact came from — one of the platform’s data sources; defaults to `api_import`, and `custom` is the catch-all for anything not listed',
  },
  locale: { ...str, maxLength: CONTACT_LOCALE_MAX },
  address: obj,
  externalId: {
    oneOf: [
      { type: 'string', maxLength: CONTACT_EXTERNAL_ID_MAX },
      {
        type: 'integer',
        minimum: -Number.MAX_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    ],
    description:
      'Stored as a string. Send a source system’s id as a string: a number ' +
      'beyond 2^53 − 1 cannot be carried exactly and is refused',
  },
  tags: {
    type: 'array',
    items: { ...str, maxLength: CONTACT_TAG_MAX },
    maxItems: CONTACT_TAGS_MAX,
  },
  metadata: obj,
  notes: { ...str, maxLength: CONTACT_NOTES_MAX },
};

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

export function buildSpec(): Json {
  const paths: Record<string, Json> = {};

  /** The tenant header on every conversation call, reads included — the
   * strict posture the projects and tasks families share: a multi-org key
   * must name its organization, a single-org key may omit it. */
  const conversationOrg = {
    ...orgSlugHeaderParam,
    description:
      'The organization to operate on. STRICTLY REQUIRED on every ' +
      'conversation call, reads included, when the key holder belongs to ' +
      'more than one organization (400 `ORG_SLUG_REQUIRED` without it); a ' +
      'single-organization key may omit it. `GET /api/v1/me` answers the ' +
      'slug to send.',
  };
  const conversationErrors = {
    ...standardErrors,
    '403': errorResponse(
      'A read-only role (`ROLE_FORBIDDEN`), an integration another ' +
        'service user owns (`INTEGRATION_NOT_OWNED`), an attachment that is ' +
        'not this integration’s upload (`ATTACHMENT_NOT_OWNED`), or an ' +
        'unverified author (`AUTHOR_UNVERIFIED`)',
    ),
    '404': errorResponse(
      'The contact `externalContactId` names does not exist ' +
        '(`CONTACT_NOT_FOUND`), or the delivery or attachment is absent ' +
        '(`DELIVERY_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`)',
    ),
    '409': errorResponse(
      'Conflicting identity, revision, or receipt: ' +
        '`CONVERSATION_SNAPSHOT_CONFLICT`, `CONVERSATION_CONTACT_CONFLICT`, ' +
        '`CONTACT_AMBIGUOUS`, `DELIVERY_UNACKNOWLEDGED`, ' +
        '`DELIVERY_RECEIPT_CONFLICT`, `DELIVERY_RETRY_UNAVAILABLE`, ' +
        '`CONVERSATION_CLOSED`',
    ),
    '413': errorResponse(
      'Request body exceeds its byte limit (`BODY_TOO_LARGE`)',
    ),
  };
  const conversationOperation = {
    tags: ['Conversations'],
    security: sec,
    parameters: [conversationOrg],
  };
  const snapshotState = {
    type: 'object',
    required: ['conversationId', 'organizationId', 'version', 'attachments'],
    properties: {
      conversationId: str,
      organizationId: str,
      version: int,
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'storageId'],
          properties: { id: str, storageId: str },
        },
      },
    },
  };
  paths['/api/v1/me'] = {
    get: {
      tags: ['Organization'],
      summary: 'Who this key acts as',
      description:
        'The key holder, the organization this request resolved to — its ' +
        '`slug` is the `X-Organization-Slug` value a multi-organization key ' +
        'sends — and every organization the holder belongs to.',
      operationId: 'getMe',
      security: sec,
      parameters: [orgSlugHeaderParam],
      responses: {
        '200': jsonResponse('The caller and its organizations', ref('Me')),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/conversations/sync'] = {
    get: {
      ...conversationOperation,
      operationId: 'getConversationSourceState',
      summary: 'Read an integration snapshot receipt',
      description:
        'Returns the current source revision and attachment refs for safe crash recovery. An unknown or differently owned source returns a null snapshot.',
      parameters: [
        conversationOrg,
        {
          ...queryParam('source', 'Stable source slug, e.g. vatplus'),
          required: true,
        },
        {
          ...queryParam('externalId', 'Stable source conversation ID'),
          required: true,
        },
      ],
      responses: {
        '200': jsonResponse('Current source state', {
          type: 'object',
          required: ['snapshot'],
          properties: { snapshot: nullable(snapshotState) },
        }),
        ...conversationErrors,
      },
    },
    post: {
      ...conversationOperation,
      operationId: 'synchronizeConversationSource',
      summary: 'Apply a complete native Inbox source snapshot',
      description:
        'Creates an API-channel Inbox conversation linked to exactly one contact.externalId. Source + externalId is owned by the API key user; key rotation preserves ownership. A newer integer version replaces only source-receipted messages; an older version does nothing; the same version with different content returns 409. Message IDs must be unique. A Tale-origin message must carry taleMessageId and have been acknowledged with its externalId first. A deleted snapshot closes the source and has no messages. Unacknowledged office replies are preserved. JSON is limited to 8 MiB.',
      requestBody: jsonBody(
        z.toJSONSchema(apiSnapshotSchema, {
          target: 'openapi-3.0',
          io: 'input',
        }),
      ),
      responses: {
        '200': jsonResponse('Applied or replayed snapshot', {
          type: 'object',
          required: ['conversationId', 'applied'],
          properties: { conversationId: nullable(str), applied: bool },
        }),
        ...conversationErrors,
      },
    },
  };
  paths['/api/v1/conversations/deliveries/claim'] = {
    post: {
      ...conversationOperation,
      operationId: 'claimConversationDeliveries',
      summary: 'Poll queued native Inbox replies',
      description:
        'Claims up to 100 due replies for a source owned by this API key user. Claim closes undo and grants a five-minute visibility lease. Unacknowledged deliveries become eligible again after their lease/backoff in retryAt/availableAt/messageId order. Use stable messageId as the destination idempotency key and claimToken when reporting a failure. JSON is limited to 64 KiB.',
      requestBody: jsonBody({
        type: 'object',
        required: ['source'],
        properties: {
          source: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,59}$' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
        },
      }),
      responses: {
        '200': jsonResponse(
          'Pending deliveries',
          listOf('deliveries', {
            type: 'object',
            required: [
              'messageId',
              'claimToken',
              'conversationId',
              'externalId',
              'actorUserId',
              'actorEmail',
              'body',
              'availableAt',
              'attachments',
            ],
            properties: {
              messageId: str,
              claimToken: { type: 'string', format: 'uuid' },
              conversationId: str,
              externalId: str,
              actorUserId: str,
              actorEmail: str,
              body: str,
              availableAt: num,
              attachments: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['storageId', 'filename', 'contentType', 'size'],
                  properties: {
                    storageId: str,
                    filename: str,
                    contentType: str,
                    size: int,
                  },
                },
              },
            },
          }),
        ),
        ...conversationErrors,
      },
    },
  };
  paths['/api/v1/conversations/deliveries/{id}/fail'] = {
    post: {
      ...conversationOperation,
      operationId: 'failConversationDelivery',
      summary: 'Report a refused or interrupted delivery',
      description:
        'Idempotent for the claimToken; stale claims cannot fail a new attempt or an acknowledged reply. A permanent refusal, or ten transient failure reports, exposes native Inbox Retry/Discard. Transient failures retry after 1, 2, 4 minutes up to one hour. Only static error codes are accepted. JSON is limited to 64 KiB.',
      parameters: [
        conversationOrg,
        pathParam('id', 'The claimed native message ID'),
      ],
      requestBody: jsonBody(
        z.toJSONSchema(apiDeliveryFailureSchema, {
          target: 'openapi-3.0',
          io: 'input',
        }),
      ),
      responses: {
        '200': jsonResponse('Failure recorded or already superseded', {
          type: 'object',
          required: ['ok'],
          properties: { ok: bool },
        }),
        ...conversationErrors,
        '404': errorResponse(
          'No delivery owned by this user (`DELIVERY_NOT_FOUND`)',
        ),
      },
    },
  };
  paths['/api/v1/conversations/deliveries/{id}/ack'] = {
    post: {
      ...conversationOperation,
      operationId: 'acknowledgeConversationDelivery',
      summary: 'Acknowledge a reply after its destination commits',
      description:
        'The receiptId is the destination message ID and sourceVersion is its committed source revision, reused unchanged on retries. Links that receipt to the existing native message and marks it delivered. A snapshot older than sourceVersion cannot delete the reply. Repeating the same receipt and version succeeds; changing either returns 409. JSON is limited to 64 KiB.',
      parameters: [
        conversationOrg,
        pathParam('id', 'The claimed native message ID'),
      ],
      requestBody: jsonBody({
        type: 'object',
        required: ['receiptId', 'sourceVersion'],
        properties: {
          receiptId: { type: 'string', minLength: 1, maxLength: 256 },
          sourceVersion: {
            type: 'integer',
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      }),
      responses: {
        '200': jsonResponse('Delivery acknowledged', {
          type: 'object',
          required: ['ok'],
          properties: { ok: bool },
        }),
        ...conversationErrors,
        '404': errorResponse(
          'No claimed delivery owned by this user (`DELIVERY_NOT_FOUND`)',
        ),
      },
    },
  };
  paths['/api/v1/conversations/deliveries/{id}/attachments/{index}'] = {
    get: {
      ...conversationOperation,
      operationId: 'downloadConversationDeliveryAttachment',
      summary: 'Download a claimed reply attachment',
      parameters: [
        conversationOrg,
        pathParam('id', 'Claimed native message ID'),
        {
          ...pathParam(
            'index',
            'Zero-based attachment position in the claimed delivery',
          ),
          schema: { type: 'integer', minimum: 0, maximum: 9 },
        },
      ],
      responses: {
        '200': {
          description:
            'Private attachment bytes, Cache-Control: private, no-store',
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        ...conversationErrors,
        '404': errorResponse(
          'No owned, claimed attachment (`DELIVERY_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`)',
        ),
      },
    },
  };
  paths['/api/v1/conversations/uploads'] = {
    post: {
      ...conversationOperation,
      operationId: 'uploadConversationSourceAttachment',
      summary: 'Stage attachment bytes for a source snapshot',
      description:
        'Uploads at most 30 MiB to this organization and records an upload intent owned by this key user. Bind the storageId, actual size and filename in a snapshot within two hours. Previously receipted refs can be reused on later source revisions.',
      requestBody: {
        required: true,
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
      responses: {
        '200': jsonResponse('Staged attachment', {
          type: 'object',
          required: ['storageId'],
          properties: { storageId: str },
        }),
        ...conversationErrors,
      },
    },
  };

  // ── Documents (the Knowledge-Hub lane) ────────────────────────────────────

  paths['/api/v1/documents'] = {
    get: {
      tags: ['Documents'],
      summary: 'List documents',
      description:
        'Knowledge-hub documents the key holder can see, newest first — ' +
        'project files never appear here (the Projects family owns them). ' +
        '`content` is not carried in the listing; read one document for it.',
      operationId: 'listDocuments',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('sourceProvider', 'Only documents from this source'),
        queryParam('folderId', 'Only documents inside this folder'),
      ],
      responses: {
        '200': jsonResponse('Paginated documents', pageOf(ref('Document'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Documents'],
      summary: 'Create document',
      description:
        'Requires a documents-write role. Send inline `content` from a REST ' +
        'client. Inline content is stored and readable but NOT indexed for ' +
        'knowledge search — only a document backed by an uploaded file ' +
        '(`fileId`) enters the search corpus, and `retry-indexing` answers ' +
        '`skipped` (`content-only`) for the rest. `fileId` must be the key ' +
        'holder’s own unbound upload in this ' +
        'organization. Missing uploads, another user’s uploads and files already ' +
        'bound to a document, thread or conversation answer 404 FILE_NOT_FOUND. ' +
        'REST does not mint hub uploads; use the app to upload first.',
      operationId: 'createDocument',
      security: sec,
      requestBody: jsonBody(ref('DocumentInput')),
      responses: {
        '201': createdId('Created — the new document’s id'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse(
          'The upload is absent, not owned by the key holder or already bound',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/documents/{id}'] = {
    get: {
      tags: ['Documents'],
      summary: 'Get document',
      description:
        'A document with its `content`. A project file, a foreign document ' +
        'and a nonexistent id all answer the same opaque 404.',
      operationId: 'getDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('The document', ref('Document')),
        '404': errorResponse('Document not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Documents'],
      summary: 'Update document',
      description:
        'Partial update; a `null` clears an optional field. Requires a ' +
        'documents-write role. Only Knowledge Hub documents are accepted; project files return 404. A controlled record under review, approval or ' +
        'legal hold refuses the change.',
      operationId: 'updateDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      requestBody: jsonBody(ref('DocumentPatch')),
      responses: {
        '204': noContent('Updated'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse('The record is protected'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Documents'],
      summary: 'Delete document',
      description:
        'Permanent deletion of a Knowledge Hub document; project files return 404. Role gate, controlled-record protection, ' +
        'legal holds, sync stop and the audit row, then the purge.',
      operationId: 'deleteDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse(
          'A protected record (`DOCUMENT_RECORD_PROTECTED`) or a legal hold (`LEGAL_HOLD_ACTIVE`)',
        ),
        '503': errorResponse(
          'The purge could not remove every dead surface (`PURGE_INCOMPLETE`): the row was kept so the delete can be retried',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/documents/{id}/retry-indexing'] = {
    post: {
      tags: ['Documents'],
      summary: 'Retry RAG indexing',
      description:
        'Re-queues a Knowledge Hub document’s blob for indexing; project files return 404. Requires a ' +
        'documents-write role. Answers `skipped` — honestly, with the ' +
        '`reason` — for a content-only document (`content-only`: inline ' +
        'text never enters the search corpus, only file-backed documents ' +
        'do), a blob the platform does not track (`untracked-blob`), or a ' +
        'file whose RAG opt-out is persisted (`rag-opt-out`).',
      operationId: 'retryDocumentIndexing',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('Whether indexing was queued', {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['indexing', 'skipped'] },
            reason: {
              type: 'string',
              enum: ['content-only', 'untracked-blob', 'rag-opt-out'],
              description:
                'Why indexing was skipped; absent when `status` is `indexing`',
            },
          },
        }),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        ...standardErrors,
      },
    },
  };

  // ── Websites ──────────────────────────────────────────────────────────────

  paths['/api/v1/websites'] = {
    get: {
      tags: ['Websites'],
      summary: 'List websites',
      operationId: 'listWebsites',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('status', 'Only websites in this crawl status'),
        queryParam('scanInterval', 'Only websites on this scan interval'),
      ],
      responses: {
        '200': jsonResponse('Paginated websites', pageOf(ref('Website'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Websites'],
      summary: 'Create website',
      description:
        'Registers a domain for crawling and schedules the first crawl. ' +
        'With `urls`, registers (or, for an existing domain, extends) a ' +
        'curated URL list instead of a whole-site crawl.',
      operationId: 'createWebsite',
      security: sec,
      requestBody: jsonBody(ref('WebsiteInput')),
      responses: {
        '201': createdId('Created — the website’s id'),
        '200': jsonResponse(
          'With `urls`, the domain was already registered as a list: its ' +
            'URLs were extended and this is the EXISTING website’s id',
          {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
        ),
        '409': errorResponse(
          'The domain is already registered as a whole-site crawl ' +
            '(`WEBSITE_DUPLICATE_DOMAIN`)',
        ),
        ...standardErrors,
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), a `domain` that names ' +
            'no http(s) host (`WEBSITE_DOMAIN_INVALID`), a domain the crawl ' +
            'policy refuses — loopback, link-local, private-network or cloud ' +
            'metadata hosts (`WEBSITE_DOMAIN_NOT_CRAWLABLE`) — or a list URL ' +
            'off the domain (`WEBSITE_INVALID_LIST_URL`)',
        ),
      },
    },
  };

  paths['/api/v1/websites/{id}'] = {
    get: {
      tags: ['Websites'],
      summary: 'Get website',
      operationId: 'getWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('The website', ref('Website')),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Websites'],
      summary: 'Update website',
      operationId: 'updateWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody(ref('WebsitePatch')),
      responses: {
        '204': noContent('Updated'),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Websites'],
      summary: 'Delete website',
      description: 'Deregisters the crawl and removes the website.',
      operationId: 'deleteWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/pages'] = {
    get: {
      tags: ['Websites'],
      summary: 'Fetch pages',
      description:
        'The crawled pages of a website — OFFSET-paginated (`offset` + ' +
        '`limit`, default 100), answering `{pages, total, offset, hasMore}`.',
      operationId: 'listWebsitePages',
      security: sec,
      parameters: [
        pathParam('id', 'Website ID'),
        queryParam(
          'offset',
          'Rows to skip (default 0; a negative or fractional value is clamped to a whole, non-negative row count)',
          { type: 'integer' },
        ),
        queryParam(
          'limit',
          'Rows to return, 1..500 (default 100; out-of-range values are clamped)',
          { type: 'integer' },
        ),
      ],
      responses: {
        '200': jsonResponse('The pages window', ref('WebsitePageList')),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/sync'] = {
    post: {
      tags: ['Websites'],
      summary: 'Sync statuses',
      description:
        'Schedules the per-site corpus → row status sync and answers ' +
        'immediately; `syncing` means the job is queued, not finished.',
      operationId: 'syncWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('Sync scheduled', {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['syncing'] } },
        }),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/search'] = {
    post: {
      tags: ['Websites'],
      summary: 'Search content',
      description:
        'A POST because it carries a body, not because it writes: semantic ' +
        'search over this website’s crawled content.',
      operationId: 'searchWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['query'],
        additionalProperties: false,
        properties: {
          query: { ...str, minLength: 1, maxLength: 1000 },
          limit: {
            type: 'integer',
            description:
              'Matches to return, 1..100 (default 10; out-of-range values are clamped)',
          },
        },
      }),
      responses: {
        '200': jsonResponse('Matches', ref('WebsiteSearchResults')),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  // ── Browser sessions ──────────────────────────────────────────────────────

  paths['/api/v1/browser-sessions'] = {
    get: {
      tags: ['Browser sessions'],
      summary: 'List browser sessions',
      description:
        'The organization’s warmed browser-session pool — the cookie jars ' +
        'the video-link ingest presents to get past a platform’s bot wall, ' +
        'with each session’s status, expiry and strike count. Masked: the ' +
        'jar itself is never returned.',
      operationId: 'listBrowserSessions',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The pool',
          listOf('sessions', ref('BrowserSession')),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/browser-sessions/import'] = {
    post: {
      tags: ['Browser sessions'],
      summary: 'Import a browser session',
      description:
        'Adds a warmed cookie jar to the pool for one domain; the jar is ' +
        'encrypted before it is stored. Restricted to organization ' +
        'administrators whose e-mail is on the deployment editor allowlist ' +
        '(`TALE_DEPLOYMENT_CONFIG_ADMINS`) — anyone else answers 403 with a ' +
        '`code` naming the gate that refused.',
      operationId: 'importBrowserSession',
      security: sec,
      requestBody: jsonBody(ref('BrowserSessionImport')),
      responses: {
        '201': jsonResponse('Imported — the session’s id', {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: str },
        }),
        '403': errorResponse(
          'The key holder may not seed the pool (FORBIDDEN_INSTANCE_ADMIN ' +
            'or FORBIDDEN_DEPLOYMENT_EDITOR)',
        ),
        ...standardErrors,
      },
    },
  };

  // ── Products ──────────────────────────────────────────────────────────────

  paths['/api/v1/products'] = {
    get: {
      tags: ['Products'],
      summary: 'List products',
      description: 'Most recently updated first.',
      operationId: 'listProducts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('status', 'Only products in this status'),
        queryParam('category', 'Only products in this category'),
      ],
      responses: {
        '200': jsonResponse('Paginated products', pageOf(ref('Product'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Create product',
      operationId: 'createProduct',
      security: sec,
      // The one schema serves create and update; only create requires
      // the name, so the requirement rides the operation, not the schema.
      requestBody: jsonBody({
        allOf: [ref('ProductInput')],
        required: ['name'],
      }),
      responses: {
        '201': createdId('Created — the product’s id'),
        '409': errorResponse(
          'Duplicate name (`DUPLICATE_PRODUCT_NAME`) or external id (`DUPLICATE_EXTERNAL_ID`)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/products/{id}'] = {
    get: {
      tags: ['Products'],
      summary: 'Get product',
      operationId: 'getProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '200': jsonResponse('The product', ref('Product')),
        '404': errorResponse('Product not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Products'],
      summary: 'Update product',
      operationId: 'updateProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      requestBody: jsonBody(ref('ProductPatch')),
      responses: {
        '200': jsonResponse('The updated product', ref('Product')),
        '404': errorResponse('Product not found (`PRODUCT_NOT_FOUND`)'),
        '409': errorResponse(
          'Duplicate name (`DUPLICATE_PRODUCT_NAME`) or external id ' +
            '(`DUPLICATE_EXTERNAL_ID`), or a stale `expectedUpdatedAt` ' +
            '(`PRODUCT_STALE`)',
        ),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Products'],
      summary: 'Delete product',
      operationId: 'deleteProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Product not found'),
        ...standardErrors,
      },
    },
  };

  // ── Contacts ──────────────────────────────────────────────────────────────

  paths['/api/v1/contacts'] = {
    get: {
      tags: ['Contacts'],
      summary: 'List contacts',
      description: 'Most recently updated first; trashed contacts are hidden.',
      operationId: 'listContacts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('source', 'Only contacts from this source'),
      ],
      responses: {
        '200': jsonResponse('Paginated contacts', pageOf(ref('Contact'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Contacts'],
      summary: 'Create contact',
      description: '`source` defaults to `api_import`.',
      operationId: 'createContact',
      security: sec,
      requestBody: jsonBody(ref('ContactInput')),
      responses: {
        '201': createdId('Created — the contact’s id'),
        '409': errorResponse(
          'Duplicate email (`CONTACT_DUPLICATE_EMAIL`) or external id ' +
            '(`CONTACT_DUPLICATE_EXTERNAL_ID`)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/bulk'] = {
    post: {
      tags: ['Contacts'],
      summary: 'Create contacts in bulk',
      description:
        'Up to 500 contacts per call, each carrying at least one of name, email or externalId (a blank email reads as none); the per-row duplicate check keys on email and externalId. Rows are ' +
        'created independently: the result counts successes and failures ' +
        'and names each failed row with its reason.',
      operationId: 'bulkCreateContacts',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['contacts'],
        properties: {
          contacts: {
            type: 'array',
            maxItems: 500,
            items: ref('ContactInput'),
          },
        },
      }),
      responses: {
        '201': jsonResponse('Bulk creation result', ref('BulkCreateResult')),
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
        '200': jsonResponse('The contact', ref('Contact')),
        '404': errorResponse('Contact not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Contacts'],
      summary: 'Update contact',
      description:
        'Optionally send expectedUpdatedAt from the last contact read. The update locks and checks that revision atomically; a stale revision returns 409 CONTACT_STALE without changing any field. Every successful update advances updatedAt, even within one millisecond. Omit the precondition for the existing unconditional behavior.',
      operationId: 'patchContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      requestBody: jsonBody(ref('ContactPatch')),
      responses: {
        '200': jsonResponse('The updated contact', ref('Contact')),
        '404': errorResponse('Contact not found (`CONTACT_NOT_FOUND`)'),
        '409': errorResponse(
          'Duplicate email (`CONTACT_DUPLICATE_EMAIL`) or external id ' +
            '(`CONTACT_DUPLICATE_EXTERNAL_ID`), or a stale ' +
            '`expectedUpdatedAt` (`CONTACT_STALE`)',
        ),
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
        '204': noContent('Deleted'),
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
        'key. Shares the general REST bucket (120/min, keyed on the key ' +
        'holder).',
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
        '200': jsonResponse(
          'Zero or one matching project',
          listOf('projects', ref('Project')),
        ),
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
        'derived key that is already taken gets a numeric suffix, and a ' +
        'name no key can be derived from creates the project keyless — a ' +
        'name-only create never fails on a key the caller did not choose. ' +
        'Only an EXPLICIT `key` that is taken answers 409.',
      operationId: 'createProject',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          externalItemId: { type: 'string', maxLength: 256 },
          key: {
            type: 'string',
            description:
              'Immutable 2-6 char task-key prefix. Omitted: derived from ' +
              'the name (suffixed when taken), keyless when underivable. ' +
              'Letters and digits only; normalized to uppercase, never ' +
              'truncated. An explicit key that is taken is a 409.',
            maxLength: 6,
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
        '403': errorResponse(
          'The key holder is not an org editor (`ROLE_FORBIDDEN`)',
        ),
        '409': errorResponse(
          'Duplicate externalItemId (`PROJECT_DUPLICATE_EXTERNAL_ID`) or ' +
            'an explicit project key that is taken (`PROJECT_KEY_TAKEN`)',
        ),
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

  const projectAgentParameters = [
    orgSlugHeaderParam,
    pathParam('id', 'Project ID — required for every agent operation'),
  ];
  const projectAgentErrors = {
    ...standardErrors,
    '400': errorResponse(
      'A body the schema refuses (`INVALID_BODY`); a harness that cannot ' +
        'run project agents (`PROJECT_AGENT_HARNESS_INVALID`); a provider ' +
        'this organization has no credential for ' +
        '(`PROJECT_AGENT_PROVIDER_UNKNOWN`) or a model it cannot call, or ' +
        'that only a subscription bound to another harness serves ' +
        '(`PROJECT_AGENT_MODEL_INVALID`) — `GET /api/v1/models` lists the ' +
        'pairs; a tool grant outside the catalog ' +
        '(`PROJECT_AGENT_TOOL_UNKNOWN`), a skill the project cannot see ' +
        '(`PROJECT_AGENT_SKILL_UNKNOWN`) or a connector the organization ' +
        'has not connected (`PROJECT_AGENT_CONNECTOR_UNKNOWN`); a duplicate ' +
        'name (`PROJECT_AGENT_NAME_TAKEN`); or the 50-agent limit ' +
        '(`PROJECT_AGENT_LIMIT`)',
    ),
    '403': errorResponse(
      'Project is not editable, is archived, or the caller cannot change secret grants',
    ),
    '404': errorResponse(
      'Project is missing or invisible, or agent does not belong to this project',
    ),
  };
  const projectAgentResponse = {
    type: 'object',
    required: ['agent'],
    properties: { agent: ref('ProjectAgent') },
  };
  paths['/api/v1/projects/{id}/agents'] = {
    get: {
      tags: ['Agents'],
      summary: 'List project agents',
      description:
        'The complete agent roster of this project (at most 50). Uses the same records and project visibility as the project Agents tab. Multi-organization key holders must supply X-Organization-Slug, including on reads.',
      operationId: 'listProjectAgents',
      security: sec,
      parameters: projectAgentParameters,
      responses: {
        '200': jsonResponse(
          'Project agent roster',
          listOf('agents', ref('ProjectAgent')),
        ),
        ...projectAgentErrors,
      },
    },
    post: {
      tags: ['Agents'],
      summary: 'Create a project agent',
      description:
        'Creates an agent in the named project using its existing access rules. Requires project edit access; archived projects are read-only. Agent names are unique within the project (case-insensitive), and a project holds at most 50 agents. Invalid configuration, a duplicate name, or exceeding the limit answers 400.',
      operationId: 'createProjectAgent',
      security: sec,
      parameters: projectAgentParameters,
      requestBody: jsonBody(ref('ProjectAgentInput')),
      responses: {
        '201': jsonResponse('Created project agent', projectAgentResponse),
        ...projectAgentErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/agents/{agentId}'] = {
    get: {
      tags: ['Agents'],
      summary: 'Get a project agent',
      operationId: 'getProjectAgent',
      security: sec,
      parameters: [
        ...projectAgentParameters,
        pathParam('agentId', 'Agent ID within this project'),
      ],
      responses: {
        '200': jsonResponse('Project agent', projectAgentResponse),
        ...projectAgentErrors,
      },
    },
    put: {
      tags: ['Agents'],
      summary: 'Update a project agent',
      description:
        'Saves the complete configuration of an existing agent in this project. Omitted optional fields reset to their empty values. Requires project edit access; changing secret-name grants requires an organization admin. An agent from another project answers 404 even if the key holder can access both projects.',
      operationId: 'updateProjectAgent',
      security: sec,
      parameters: [
        ...projectAgentParameters,
        pathParam('agentId', 'Agent ID within this project'),
      ],
      requestBody: jsonBody(ref('ProjectAgentInput')),
      responses: {
        '200': jsonResponse('Saved project agent', projectAgentResponse),
        ...projectAgentErrors,
      },
    },
    delete: {
      tags: ['Agents'],
      summary: 'Delete a project agent',
      operationId: 'deleteProjectAgent',
      security: sec,
      parameters: [
        ...projectAgentParameters,
        pathParam('agentId', 'Agent ID within this project'),
      ],
      responses: {
        '204': noContent('Deleted'),
        ...projectAgentErrors,
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
        '200': jsonResponse(
          'The root folders',
          listOf('folders', ref('ProjectFolder')),
        ),
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
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          parentId: {
            type: 'string',
            maxLength: 64,
            description: 'Parent folder id (a folder of this project)',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The existing folder', ref('ProjectFolderResult')),
        '201': jsonResponse('The created folder', ref('ProjectFolderResult')),
        '403': errorResponse('No write access to an active project'),
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
        'Answers where to send the bytes: a presigned `PUT` URL for the ' +
        'organization’s bucket (every 0.5 blob is S3-backed) plus the ' +
        '`s3Ref` to bind afterwards as `fileId` — a declared `contentType` ' +
        'is signed into the URL, so the PUT must carry that exact ' +
        '`Content-Type` header (omit `contentType` and the PUT has no ' +
        'header requirement). The `uploadId` is a single-use intent valid ' +
        'until `expiresAt` (30 minutes); complete the upload with ' +
        '`POST /api/v1/projects/{id}/files`. The signed URL is valid for ' +
        'exactly as long as the intent — `expiresAt` is the one deadline ' +
        'for both. Requires the org editor ' +
        'role and project edit access. Uses the upload lane bucket ' +
        '(240/min — one logical upload is several calls; keyed on the key ' +
        'holder like every REST budget).',
      operationId: 'createProjectUpload',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody(
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            fileName: {
              type: 'string',
              minLength: 1,
              maxLength: 1024,
              description:
                'Optional. Checked against the bind’s own rule (a file ' +
                'name — no path separators, no `..`, no control ' +
                'characters) so a bad name fails here, before the bytes ' +
                'are uploaded; the bind’s `fileName` is what is stored.',
            },
            contentType: { type: 'string', maxLength: 255 },
          },
        },
        false,
      ),
      responses: {
        '200': jsonResponse('The upload handoff', ref('ProjectUploadHandoff')),
        '403': errorResponse('No write access to an active project'),
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
        'report). Every blob is object-storage backed, so the answer is a ' +
        '**302** to a short-lived presigned URL — follow redirects. ' +
        'Visibility is the minting user’s; a cross-project, ' +
        'cross-organization, trashed, or absent file answers the same ' +
        'opaque 404.',
      operationId: 'downloadProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '302': {
          description: 'Redirect to a short-lived presigned URL',
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
        ...paginationParams(100, 25, 'cursor'),
      ],
      responses: {
        '200': jsonResponse('The files', {
          type: 'object',
          required: ['files', 'isDone'],
          properties: {
            files: { type: 'array', items: ref('ProjectFile') },
            isDone: {
              type: 'boolean',
              description: 'True when no more pages remain',
            },
            cursor: {
              type: 'string',
              description:
                'Present while more pages remain — pass back as `cursor`',
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
        'creates the document. `fileId` is the `s3Ref` the handoff ' +
        'answered. `folderId` is ' +
        'REQUIRED and must belong to this project. `skipRagIndexing` ' +
        'DEFAULTS TO TRUE — project ledger files are working material, not ' +
        'organization knowledge; pass `false` explicitly to index the file ' +
        'into the knowledge corpus. The organization’s upload policy applies ' +
        'to the landed bytes (authoritative size): a size cap, extension ' +
        'allowlist, or per-user volume refusal answers 400 with ' +
        'code `UPLOAD_POLICY_REJECTED` / `FILE_TOO_LARGE` / ' +
        '`UNSUPPORTED_FILE_TYPE` (the allowlist keys on the file name’s ' +
        'extension; a declared `contentType` is a hint resolved against ' +
        'it), and the organization’s `file:upload` ' +
        'budget answers 429. `fileName` must be a file name — no path ' +
        'separators, no `..`, no control characters. A refusal rolls the ' +
        'intent consume back, so the handshake survives a corrected retry. ' +
        'Uses the upload lane bucket (240/min, keyed on the key holder).',
      operationId: 'bindProjectFile',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['uploadId', 'fileId', 'folderId', 'fileName'],
        properties: {
          uploadId: { type: 'string', minLength: 1, maxLength: 64 },
          fileId: { type: 'string', minLength: 1, maxLength: 2048 },
          folderId: { type: 'string', minLength: 1, maxLength: 64 },
          fileName: { type: 'string', minLength: 1, maxLength: 1024 },
          contentType: { type: 'string', maxLength: 255 },
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
        '403': errorResponse('No write access to an active project'),
        '404': errorResponse('Project or folder not found'),
        ...standardErrors,
        // Richer than the standard 400: the upload-policy refusals land
        // here too, each with its code.
        '400': errorResponse(
          'Malformed body, or the upload policy refused the file ' +
            '(`UPLOAD_POLICY_REJECTED`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`)',
        ),
        '409': errorResponse(
          'The upload intent is unknown, expired or already consumed — mint ' +
            'a new handoff (`UPLOAD_INTENT_INVALID`) — or `fileId` is not ' +
            'the `s3Ref` it was minted for (`UPLOAD_FILE_MISMATCH`)',
        ),
      },
    },
  };

  // ── Tasks ─────────────────────────────────────────────────────────────────

  const taskCollectionParameters = [
    orgSlugHeaderParam,
    pathParam('id', 'Project ID'),
  ];
  const taskParameters = [
    ...taskCollectionParameters,
    pathParam('taskId', 'Task ID in this project'),
  ];
  const taskNotFound = errorResponse(
    'Project or task missing, invisible, or outside this project',
  );
  paths['/api/v1/projects/{id}/tasks'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Create a project task from an external ref (idempotent)',
      description:
        'Uses the project in the URL and requires project write access. The first ' +
        '`(project, externalSystem, externalId)` intake creates a task (201); a repeat ' +
        'returns the same task (200). An active task takes the new title and description ' +
        '(omitting description clears it); labels change only when supplied. An archived ' +
        'task stays unchanged. An archived project refuses intake. The key holder creates ' +
        'the task. `automationSlug` must ' +
        'name a deployed automation applicable to this project and fills an empty assignee ' +
        'without replacing an existing one. `runWorkflowSlug` starts only a freshly created ' +
        'task; poll its executionId at `GET /api/v1/projects/{id}/runs/{runId}`. An undeployed ' +
        'workflow or a start failure after the task committed returns executionId null. ' +
        'An idempotent repeat omits executionId and does not re-validate `runWorkflowSlug` ' +
        '(a stable retry payload reconciles the task as documented). Supplying runWorkflowSlug charges the ' +
        'execute bucket before intake, in addition to the general REST bucket. Scope ' +
        'selectors such as projectId are refused in the body.',
      operationId: 'createTask',
      security: sec,
      parameters: taskCollectionParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['externalSystem', 'externalId', 'title'],
        properties: {
          externalSystem: { type: 'string', minLength: 1, maxLength: 100 },
          externalId: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
              'Caller-owned idempotency key within this project and external system',
          },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: TASK_TITLE_MAX,
            description:
              'The board’s title cap; a longer title is refused with 400 ' +
              '`INVALID_BODY`, never clipped',
          },
          description: { type: 'string', maxLength: 20000 },
          labels: {
            type: 'array',
            items: { type: 'string', maxLength: TASK_LABEL_CHARS_MAX },
            maxItems: 50,
            description: 'Names resolved against the project label catalog',
          },
          externalUrl: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description:
              'An absolute http(s) URL to the source item, rendered as a ' +
              'link; any other scheme is refused. Changes only when supplied.',
          },
          externalState: {
            type: 'string',
            enum: ['open', 'closed'],
            description:
              'The source item’s lifecycle (default `open`). `closed` parks ' +
              'the task for review — done, when the caller may complete it; ' +
              '`open` reopens a done task. Local triage owns every other ' +
              'status.',
          },
          runWorkflowSlug: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Workflow to start only when this request creates a task; must be applicable to the URL project',
          },
          automationSlug: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Deployed owning automation applicable to this project; takes precedence over runWorkflowSlug for task assignment',
          },
        },
      }),
      responses: {
        '201': jsonResponse('Created', ref('TaskUpsertResult')),
        '200': jsonResponse(
          'The task already existed',
          ref('TaskUpsertResult'),
        ),
        '403': errorResponse(
          'Project is read-only or archived, or the automation is bound to other projects',
        ),
        '404': errorResponse(
          'Project missing or invisible, or the explicit owning automation is not deployed',
        ),
        ...standardErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/tasks/{taskId}'] = {
    get: {
      tags: ['Tasks'],
      summary: 'Read a project task',
      description:
        'The task must belong to the URL project and be visible to the key holder. Archived tasks remain readable. Keep the executionId from a start to poll `GET /api/v1/projects/{id}/runs/{runId}`; the task response has no live-run linkage.',
      operationId: 'getTask',
      security: sec,
      parameters: taskParameters,
      responses: {
        '200': jsonResponse('The task', {
          type: 'object',
          required: ['task'],
          properties: { task: ref('Task') },
        }),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/tasks/{taskId}/comments'] = {
    get: {
      tags: ['Tasks'],
      summary: 'Read a project task’s discussion',
      description:
        'The newest page first, chronological within each page. The default is 200 comments, at most 500. While isDone is false, pass continueCursor as cursor to read older comments. The task must belong to this project and be visible to the key holder.',
      operationId: 'listTaskComments',
      security: sec,
      parameters: [...taskParameters, ...paginationParams(500, 200)],
      responses: {
        '200': jsonResponse('The discussion page', {
          type: 'object',
          required: ['comments', 'isDone', 'continueCursor'],
          properties: {
            comments: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'authorType', 'authorId', 'body', 'createdAt'],
                properties: {
                  id: str,
                  authorType: { type: 'string', enum: ['user', 'agent'] },
                  authorId: str,
                  body: str,
                  createdAt: num,
                  editedAt: num,
                },
              },
            },
            isDone: {
              type: 'boolean',
              description:
                'True when this page reaches the start of the discussion',
            },
            continueCursor: {
              type: 'string',
              description: 'Cursor for older comments; empty when done',
            },
          },
        }),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Comment on a project task as the key holder',
      description:
        'Any member who can read the project may comment; an editor seat is not required. The task must belong to the URL project, and the project must be active. Comments use the key holder as author and share the app’s per-user task:comment budget and mention behavior.',
      operationId: 'addTaskComment',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 1, maxLength: 10000 },
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
              properties: { id: str },
            },
          },
        }),
        '403': errorResponse('The project is archived'),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/tasks/{taskId}/start'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Start a deployed workflow on a project task',
      description:
        'Requires write access to an active project and a task belonging to it. Runs the deployed workflow with this task as its input, attributed to the URL project and api-key:<userId>. An organization automation can operate in the project; a project-bound automation must include this project. A concurrent start reuses the live run. An undeployed workflow returns not_started; other refusals return their error status. Poll executionId at `GET /api/v1/projects/{id}/runs/{runId}`. Charges the execute bucket on top of the general REST bucket.',
      operationId: 'startTaskWorkflow',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['workflowSlug'],
        properties: {
          workflowSlug: { type: 'string', minLength: 1, maxLength: 200 },
        },
      }),
      responses: {
        '200': jsonResponse('The start outcome', {
          type: 'object',
          required: ['started', 'executionId'],
          properties: {
            started: bool,
            reason: {
              type: 'string',
              enum: ['already_running', 'not_started'],
              description: 'Present when started is false',
            },
            executionId: {
              type: 'string',
              nullable: true,
              description:
                'New or existing run ID for GET /api/v1/projects/{id}/runs/{runId}; null when not_started',
            },
          },
        }),
        '403': errorResponse(
          'Project is read-only or archived, or the automation is bound elsewhere',
        ),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
  };

  // ── Automations ───────────────────────────────────────────────────────────

  paths['/api/v1/automations'] = {
    get: {
      tags: ['Automations'],
      summary: 'List automations',
      description:
        'The organization’s automation definitions, by name, as a complete set ' +
        '(not paginated). Each carries the ids of the projects it is installed ' +
        'in that the key holder can see — the scope a project-bound automation ' +
        'must be started in. Read `/api/v1/projects/{id}/automations` for the ' +
        'automations installed in one visible project.',
      operationId: 'listAutomations',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The organization’s automations',
          listOf('automations', ref('AutomationSummary')),
        ),
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
        '404': errorResponse('Automation not found (`AUTOMATION_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Automations'],
      summary: 'Delete an automation',
      description:
        'Retires the automation: every version, its trigger and its project ' +
        'installations. Run history is kept. Requires the developer ' +
        'capability. A run still in flight refuses the delete — cancel or ' +
        'wait for it first.',
      operationId: 'deleteAutomation',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse(
          'The key holder lacks the developer capability (`ROLE_FORBIDDEN`)',
        ),
        '404': errorResponse('Automation not found (`AUTOMATION_NOT_FOUND`)'),
        '409': errorResponse(
          'A run is still in flight (`AUTOMATION_HAS_ACTIVE_RUNS`)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/versions'] = {
    get: {
      tags: ['Automations'],
      summary: 'List an automation’s versions',
      description: 'The immutable version history, complete — not paginated.',
      operationId: 'listAutomationVersions',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'Immutable version history',
          listOf('versions', ref('AutomationVersion'), { name: str }),
        ),
        '404': errorResponse('Automation not found (`AUTOMATION_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  const projectAutomationParameters = [
    orgSlugHeaderParam,
    pathParam('id', 'Project ID'),
  ];
  paths['/api/v1/projects/{id}/automations'] = {
    get: {
      tags: ['Automations'],
      summary: 'List automations installed in a project',
      description:
        'The definitions explicitly bound to the URL project, each with the ' +
        'ids of the projects it is installed in that the key holder can see. ' +
        'Requires project read access. Organization-wide definitions are ' +
        'available from the global catalog.',
      operationId: 'listProjectAutomations',
      security: sec,
      parameters: projectAutomationParameters,
      responses: {
        '200': jsonResponse(
          'Installed automations',
          listOf('automations', ref('AutomationSummary')),
        ),
        '404': errorResponse('Project missing or invisible'),
        ...standardErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/automations/{name}'] = {
    delete: {
      tags: ['Automations'],
      summary: 'Uninstall an automation from a project',
      description:
        'Removes the binding to the URL project — the inverse of the install. ' +
        'The definition, its other installations and its run history stay. ' +
        'Requires the developer capability and write access to an active ' +
        'project.',
      operationId: 'unbindAutomationProject',
      security: sec,
      parameters: [...projectAutomationParameters, automationNameParam],
      responses: {
        '204': noContent('Uninstalled'),
        '403': errorResponse(
          'Requires developer capability and write access to an active project',
        ),
        '404': errorResponse(
          'Automation or visible project not found (`AUTOMATION_NOT_FOUND`, ' +
            '`PROJECT_NOT_FOUND`), or the automation is not installed here ' +
            '(`AUTOMATION_NOT_INSTALLED`)',
        ),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Automations'],
      summary: 'Install an automation in a project',
      description:
        'Idempotently binds the named automation to the URL project. Requires the developer capability and write access to an active project. Send no body or an empty object. Answers 201 when added and 200 when already bound. An automation with bindings can run only in those projects; an unbound definition can run organization-wide or in a visible project.',
      operationId: 'bindAutomationProject',
      security: sec,
      parameters: [...projectAutomationParameters, automationNameParam],
      requestBody: jsonBody(
        { type: 'object', additionalProperties: false, properties: {} },
        false,
      ),
      responses: {
        '201': jsonResponse('Binding added', {
          type: 'object',
          required: ['name', 'added'],
          properties: { name: str, added: { type: 'boolean', enum: [true] } },
        }),
        '200': jsonResponse('Already installed', {
          type: 'object',
          required: ['name', 'added'],
          properties: { name: str, added: { type: 'boolean', enum: [false] } },
        }),
        '403': errorResponse(
          'Requires developer capability and write access to an active project',
        ),
        '404': errorResponse('Automation or visible project not found'),
        ...standardErrors,
      },
    },
  };
  for (const scope of [
    { path: '/api/v1/automations/{name}/runs', project: false },
    { path: '/api/v1/projects/{id}/automations/{name}/runs', project: true },
  ]) {
    const parameters = scope.project
      ? [...projectAutomationParameters, automationNameParam]
      : [orgSlugHeaderParam, automationNameParam];
    const runPath = scope.project
      ? '/api/v1/projects/{id}/runs/{runId}'
      : '/api/v1/runs/{runId}';
    paths[scope.path] = {
      get: {
        tags: ['Automations'],
        summary: scope.project
          ? 'List an automation’s runs in a project'
          : 'List an automation’s organization runs',
        description: `Newest first, as a bounded window (limit 1–200, default 50). ${scope.project ? 'Includes only runs attributed to the URL project; requires project read access.' : 'Includes only runs without a project. Project runs are read through their project URL.'} Poll a run at GET ${runPath}.`,
        operationId: scope.project
          ? 'listProjectAutomationRuns'
          : 'listAutomationRuns',
        security: sec,
        parameters: [
          ...parameters,
          queryParam(
            'limit',
            'Newest runs to return, from 1 to 200; default 50',
            { type: 'integer' },
          ),
        ],
        responses: {
          '200': jsonResponse('Newest runs first', listOf('runs', ref('Run'))),
          '404': errorResponse(
            scope.project
              ? 'Project missing or invisible (`PROJECT_NOT_FOUND`), or automation not found (`AUTOMATION_NOT_FOUND`)'
              : 'Automation not found (`AUTOMATION_NOT_FOUND`)',
          ),
          ...standardErrors,
        },
      },
      post: {
        tags: ['Automations'],
        summary: scope.project
          ? 'Start an automation run in a project'
          : 'Start an organization automation run',
        description: `Answers 202 with the run identity; poll GET ${runPath}. Mode defaults to live and requires the developer capability. ${scope.project ? 'Both live and mock starts require write access to the active URL project. An automation with bindings must include this project; an unbound definition may also run here.' : 'Mock mode requires membership. Only definitions without project bindings can start here; a project-bound definition returns 409 AUTOMATION_PROJECT_SCOPE_REQUIRED.'} The body accepts input, mode and version only. Charges the execute bucket on top of the general REST bucket.`,
        operationId: scope.project
          ? 'startProjectAutomationRun'
          : 'startAutomationRun',
        security: sec,
        parameters,
        requestBody: jsonBody(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              input: {
                description:
                  'Run input; must match the automation inputs schema when declared. Defaults to an empty object.',
              },
              mode: { type: 'string', enum: ['live', 'mock'], default: 'live' },
              version: {
                type: 'integer',
                minimum: 1,
                description:
                  'Omitted: the deployed version. Live accepts only that version; mock accepts any saved version.',
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
              runId: str,
              version: int,
              name: str,
              mode: { type: 'string', enum: ['live', 'mock'] },
            },
          }),
          '403': errorResponse(
            scope.project
              ? 'Requires write access to an active project; live also requires developer capability; automation must apply to the project'
              : 'A live run requires developer capability',
          ),
          '404': errorResponse(
            scope.project
              ? 'Automation, version or visible project not found'
              : 'Automation or version not found',
          ),
          '409': errorResponse(
            scope.project
              ? 'No deployed version (`AUTOMATION_NOT_DEPLOYED`), or the requested live version is not deployed (`AUTOMATION_VERSION_NOT_DEPLOYED`)'
              : 'Project scope is required (`AUTOMATION_PROJECT_SCOPE_REQUIRED` — `data.projectIds` names the visible projects the automation is installed in; start it at `/api/v1/projects/{id}/automations/{name}/runs`), no version is deployed (`AUTOMATION_NOT_DEPLOYED`), or the requested live version is not deployed (`AUTOMATION_VERSION_NOT_DEPLOYED`)',
          ),
          ...standardErrors,
        },
      },
    };
  }

  paths['/api/v1/automations/{name}/triggers'] = {
    get: {
      tags: ['Automations'],
      summary: 'Read the automation’s trigger',
      description:
        'The trigger binding — at most one per automation, answered as a ' +
        'list. Never the webhook secret: `hasToken` says one exists.',
      operationId: 'listAutomationTriggers',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'The trigger binding',
          listOf('triggers', ref('Trigger'), { name: str }),
        ),
        '404': errorResponse('Automation not found (`AUTOMATION_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Automations'],
      summary: 'Bind what starts the automation',
      description:
        'Requires the developer capability. For a webhook trigger the ' +
        'plaintext token is returned ONCE in this response (and again only ' +
        'with `rotateToken: true`); the platform stores a hash. Unknown ' +
        'keys are refused (`INVALID_BODY`).',
      operationId: 'setAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['kind'],
        additionalProperties: false,
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
        '404': errorResponse('Automation not found'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Automations'],
      summary: 'Unbind the automation’s trigger',
      description:
        'For an existing automation, answers 204 whether or not a trigger existed. ' +
        'An unknown automation answers 404. Versions ' +
        'and run history stay. Requires the developer capability.',
      operationId: 'deleteAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '204': noContent('Unbound (or nothing was bound)'),
        '403': errorResponse('Needs the developer capability'),
        '404': errorResponse('Automation not found'),
        ...standardErrors,
      },
    },
  };

  // ── Runs ──────────────────────────────────────────────────────────────────

  for (const scope of [
    { path: '/api/v1/runs/{runId}', project: false },
    { path: '/api/v1/projects/{id}/runs/{runId}', project: true },
  ]) {
    const parameters = [
      orgSlugHeaderParam,
      ...(scope.project ? [pathParam('id', 'Project ID')] : []),
      pathParam('runId', 'Run ID returned by a start request'),
    ];
    const visibility = scope.project
      ? 'The run must belong to the URL project, and the key holder must have project read access.'
      : 'Only a run without a project is visible here. Use its project URL for a project run.';
    paths[scope.path] = {
      get: {
        tags: ['Runs'],
        summary: scope.project
          ? 'Read a project run in full'
          : 'Read an organization run in full',
        description: visibility,
        operationId: scope.project ? 'getProjectRun' : 'getRun',
        security: sec,
        parameters,
        responses: {
          '200': jsonResponse(
            'Status, output, trace, effects and checkpoints',
            ref('Run'),
          ),
          '404': errorResponse('Run missing or outside the visible URL scope'),
          ...standardErrors,
        },
      },
    };
    paths[`${scope.path}/cancel`] = {
      post: {
        tags: ['Runs'],
        summary: 'Stop a run at its next node boundary',
        description: `${visibility} Requires the developer capability.${scope.project ? ' The project must be active and writable.' : ''} Work already performed is not undone. Send no body or an empty object.`,
        operationId: scope.project ? 'cancelProjectRun' : 'cancelRun',
        security: sec,
        parameters,
        requestBody: jsonBody(
          { type: 'object', additionalProperties: false, properties: {} },
          false,
        ),
        responses: {
          '200': jsonResponse('Cancellation result', {
            type: 'object',
            required: ['cancelled'],
            properties: { cancelled: bool },
          }),
          '403': errorResponse(
            scope.project
              ? 'Requires developer capability and write access to an active project'
              : 'Requires developer capability',
          ),
          '404': errorResponse('Run missing or outside the visible URL scope'),
          ...standardErrors,
        },
      },
    };
  }

  // ── Threads ───────────────────────────────────────────────────────────────

  paths['/api/v1/models'] = {
    get: {
      tags: ['Threads'],
      summary: 'List available chat models',
      description:
        'The configured chat models available to the key holder in this organization, filtered by model-access policy and direct API credentials. Subscription models that require a sandbox are excluded. An empty list means none are available. Use id as model when sending a message, and providerSlug when the same id is listed under more than one provider. Each entry carries what a client needs to choose — context window, output cap, capabilities, price when the catalog publishes one, tags — and `default: true` marks the organization’s default pick for this key holder. The list is the organization’s configured catalog, not a promise from the provider’s account: a plan that excludes a listed model fails the turn with errorCode `model_not_entitled`, a spent balance with `credit_exhausted`.',
      operationId: 'listChatModels',
      security: sec,
      responses: {
        '200': jsonResponse(
          'Available models',
          listOf('models', ref('ChatModel')),
        ),
        ...standardErrors,
      },
    },
  };

  for (const scope of [
    {
      collection: '/api/v1/threads',
      item: '/api/v1/threads/{id}',
      project: false,
    },
    {
      collection: '/api/v1/projects/{id}/threads',
      item: '/api/v1/projects/{id}/threads/{threadId}',
      project: true,
    },
  ]) {
    const collectionParameters = [
      orgSlugHeaderParam,
      ...(scope.project ? [pathParam('id', 'Project ID')] : []),
    ];
    const itemParameters = [
      ...collectionParameters,
      pathParam(scope.project ? 'threadId' : 'id', 'Thread ID'),
    ];
    const visibility = scope.project
      ? 'Only the key holder’s threads belonging to the URL project; requires project read access.'
      : 'Only the key holder’s threads without a project. Project threads are available through their project URL.';
    const notFound = errorResponse(
      'Thread missing, owned by another user, or outside the visible URL scope',
    );
    paths[scope.collection] = {
      get: {
        tags: ['Threads'],
        summary: scope.project
          ? 'List your threads in a project'
          : 'List your personal threads',
        description: `${visibility} Includes archived threads, newest activity first.`,
        operationId: scope.project ? 'listProjectThreads' : 'listThreads',
        security: sec,
        parameters: [...collectionParameters, ...paginationParams(100, 25)],
        responses: {
          '200': jsonResponse('Paginated threads', pageOf(ref('Thread'))),
          ...(scope.project ? { '404': notFound } : {}),
          ...standardErrors,
        },
      },
      post: {
        tags: ['Threads'],
        summary: scope.project
          ? 'Create a chat in a project'
          : 'Create a personal chat',
        description: `A direct chat with the built-in assistant. ${scope.project ? 'The URL supplies its project context. Any member with project read access may create a chat while the project is active.' : 'The thread has no project context.'} This operation accepts only an optional title; agent selectors and projectId are refused. Project agents execute through project tasks.`,
        operationId: scope.project ? 'createProjectThread' : 'createThread',
        security: sec,
        parameters: collectionParameters,
        requestBody: jsonBody(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
            },
          },
          false,
        ),
        responses: {
          '201': createdId('Created thread ID'),
          ...(scope.project
            ? {
                '403': errorResponse('The project is archived'),
                '404': notFound,
              }
            : {}),
          ...standardErrors,
        },
      },
    };
    const archivedProject = scope.project
      ? { '403': errorResponse('The project is archived') }
      : {};
    paths[scope.item] = {
      get: {
        tags: ['Threads'],
        summary: 'Read a thread',
        description: visibility,
        operationId: scope.project ? 'getProjectThread' : 'getThread',
        security: sec,
        parameters: itemParameters,
        responses: {
          '200': jsonResponse('The thread', ref('Thread')),
          '404': notFound,
          ...standardErrors,
        },
      },
      patch: {
        tags: ['Threads'],
        summary: 'Archive or restore a thread',
        description: `${visibility} Archiving is the app’s own toggle, audited the same way: an archived thread stays readable and refuses messages with 409 \`CHAT_THREAD_ARCHIVED\`; \`archived: false\` restores it.`,
        operationId: scope.project ? 'updateProjectThread' : 'updateThread',
        security: sec,
        parameters: itemParameters,
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['archived'],
          properties: { archived: bool },
        }),
        responses: {
          '200': jsonResponse('The thread after the change', ref('Thread')),
          ...archivedProject,
          '404': notFound,
          ...standardErrors,
        },
      },
      delete: {
        tags: ['Threads'],
        summary: 'Delete a thread',
        description: `${visibility} Moves the thread to the app’s trash (its grace window and legal-hold check apply). A thread whose turn is still running answers 409 \`CHAT_TURN_IN_PROGRESS\` — cancel the turn first.`,
        operationId: scope.project ? 'deleteProjectThread' : 'deleteThread',
        security: sec,
        parameters: itemParameters,
        responses: {
          '204': noContent('Deleted'),
          ...archivedProject,
          '404': notFound,
          '409': errorResponse(
            'A turn is running on the thread (`CHAT_TURN_IN_PROGRESS`)',
          ),
          ...standardErrors,
        },
      },
    };
    paths[`${scope.item}/messages`] = {
      get: {
        tags: ['Threads'],
        summary: 'Read a thread’s messages',
        description: `${visibility} Messages are in sequence order; use the previous continueCursor as cursor for the next page. While a turn runs, its assistant row is already on the page with status \`pending\` and empty parts — the row GET ${scope.item}/generation names as messageId — and is filled in when the turn settles; the page is complete without that row being final.`,
        operationId: scope.project
          ? 'listProjectThreadMessages'
          : 'listMessages',
        security: sec,
        parameters: [...itemParameters, ...paginationParams(100, 25)],
        responses: {
          '200': jsonResponse('Paginated messages', pageOf(ref('Message'))),
          '404': notFound,
          ...standardErrors,
        },
      },
      post: {
        tags: ['Threads'],
        summary: 'Send a message and start a turn',
        description: `${visibility} ${scope.project ? 'The project must be active; members can send without an editor seat. ' : ''}Answers 202 while the turn runs in the background. Poll GET ${scope.item}/generation until status is idle, then read the messages. A turn failure appears as an assistant error message. Charges the execute bucket on top of the general REST bucket.`,
        operationId: scope.project ? 'postProjectThreadMessage' : 'postMessage',
        security: sec,
        parameters: itemParameters,
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['content', 'model'],
          properties: {
            content: {
              type: 'string',
              minLength: 1,
              maxLength: 100000,
              description:
                'The prompt, trimmed before the length check — a blank prompt is 400 `INVALID_BODY`, not a turn.',
            },
            model: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description:
                'Model ID from GET /api/v1/models; never auto-selected. Checked at the door: an id the list does not carry answers 400 `CHAT_MODEL_UNKNOWN`.',
            },
            providerSlug: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description:
                'Provider slug returned with the model. Checked against GET /api/v1/models: a slug the list does not carry answers 400 `CHAT_PROVIDER_UNKNOWN`, one that does not serve the model 400 `CHAT_MODEL_NOT_ON_PROVIDER` — never a silent fallback to another provider. Optional when exactly one listed provider serves the model; a model listed under several providers answers 400 `CHAT_MODEL_AMBIGUOUS` with `data.providers` until one is named. The 202 names the provider the turn runs on either way.',
            },
            locale: {
              type: 'string',
              minLength: 2,
              maxLength: 20,
              pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$',
              description:
                'A BCP 47 language tag (`de`, `en-GB`) — the language the assistant is asked to answer in. Defaults to `en`.',
            },
          },
        }),
        responses: {
          '202': jsonResponse('Turn accepted', {
            type: 'object',
            required: ['threadId', 'status', 'model', 'providerSlug', 'poll'],
            properties: {
              threadId: str,
              status: { type: 'string', enum: ['accepted'] },
              model: str,
              providerSlug: {
                ...str,
                description:
                  'The provider the turn runs on — named in the request, or resolved from the model list',
              },
              poll: {
                type: 'string',
                description: `Poll URL under ${scope.item}/generation`,
              },
            },
          }),
          ...archivedProject,
          '404': notFound,
          '409': errorResponse(
            'The thread is archived (`CHAT_THREAD_ARCHIVED`) or not a direct chat (`CHAT_THREAD_NOT_DIRECT`), or a turn is already running (`CHAT_TURN_IN_PROGRESS`)',
          ),
          ...standardErrors,
          '400': errorResponse(
            'Invalid body (`INVALID_BODY`), a model the list does not carry (`CHAT_MODEL_UNKNOWN`), a model listed under several providers with none named (`CHAT_MODEL_AMBIGUOUS`), an unknown providerSlug (`CHAT_PROVIDER_UNKNOWN`), or a provider that does not serve the model (`CHAT_MODEL_NOT_ON_PROVIDER`)',
          ),
        },
      },
    };
    paths[`${scope.item}/generation`] = {
      get: {
        tags: ['Threads'],
        summary: 'Poll the running turn',
        description: visibility,
        operationId: scope.project
          ? 'getProjectThreadGeneration'
          : 'getGeneration',
        security: sec,
        parameters: itemParameters,
        responses: {
          '200': jsonResponse(
            'Idle when no turn is running; otherwise the live status',
            {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['idle', 'queued', 'streaming'],
                },
                messageId: {
                  type: 'string',
                  description: 'Assistant message being streamed',
                },
              },
            },
          ),
          '404': notFound,
          ...standardErrors,
        },
      },
      delete: {
        tags: ['Threads'],
        summary: 'Cancel the running turn',
        description: `${visibility} Asks the running turn to stop — the app’s own stop: the turn reads the flag at its next progress write and settles what it has. 202 means the stop is requested, not done; poll until idle. No running turn answers 404 \`CHAT_TURN_NOT_RUNNING\`.`,
        operationId: scope.project
          ? 'cancelProjectThreadGeneration'
          : 'cancelGeneration',
        security: sec,
        parameters: itemParameters,
        responses: {
          '202': jsonResponse('Cancellation requested', {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['cancelling'] },
              messageId: {
                type: 'string',
                description: 'The assistant message the turn was writing',
              },
            },
          }),
          ...archivedProject,
          '404': errorResponse(
            'Thread missing, owned by another user, or outside the visible URL scope (`THREAD_NOT_FOUND`); or no turn is running (`CHAT_TURN_NOT_RUNNING`)',
          ),
          ...standardErrors,
        },
      },
    };
  }

  // ── Skills ────────────────────────────────────────────────────────────────

  paths['/api/v1/skills'] = {
    get: {
      tags: ['Skills'],
      summary: 'List skills',
      description:
        'The skills the key holder can see (their own, their teams’, the ' +
        'organization’s) — a complete set, not paginated. `failures` names ' +
        'skill bundles that could not be read.',
      operationId: 'listSkills',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The organization’s skills',
          listOf('skills', ref('SkillSummary'), {
            failures: {
              type: 'array',
              description:
                'Skill bundles on disk that could not be read — each names the bundle and why',
              items: {
                type: 'object',
                required: ['slug', 'path', 'message'],
                properties: {
                  slug: str,
                  path: {
                    ...str,
                    description:
                      'The bundle’s path inside the organization’s skills tree',
                  },
                  message: str,
                },
              },
            },
          }),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/skills/{slug}'] = {
    get: {
      tags: ['Skills'],
      summary: 'Get skill',
      operationId: 'getSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      responses: {
        '200': jsonResponse('The skill', ref('Skill')),
        '404': errorResponse('No such skill'),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Skills'],
      summary: 'Create or replace skill',
      operationId: 'saveSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      requestBody: jsonBody({
        type: 'object',
        required: ['description', 'body'],
        properties: {
          description: { type: 'string', maxLength: 1024 },
          body: { type: 'string', maxLength: 1_000_000 },
          visibility: { type: 'string', enum: ['team', 'org'] },
          teams: { type: 'array', items: str, maxItems: 32 },
          icon: str,
          labels: { type: 'array', items: str, maxItems: 50 },
        },
      }),
      responses: {
        '200': jsonResponse('The saved skill', ref('Skill')),
        '403': errorResponse('Not editable with this key (`SKILL_FORBIDDEN`)'),
        '422': errorResponse('The skill body is malformed (`SKILL_MALFORMED`)'),
        ...standardErrors,
        '400': errorResponse(
          'Invalid body (`INVALID_BODY`), a slug the file layer refuses (`INVALID_SKILL_SLUG`), an invalid skill (`INVALID_SKILL`), the retired private visibility (`SKILL_PRIVATE_RETIRED`), or a team id the organization does not have (`SKILL_TEAM_UNKNOWN`)',
        ),
      },
    },
    delete: {
      tags: ['Skills'],
      summary: 'Delete skill',
      operationId: 'deleteSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('Not deletable with this key (`SKILL_FORBIDDEN`)'),
        '404': errorResponse('No such skill (`SKILL_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  // ── Knowledge ─────────────────────────────────────────────────────────────

  /** The body both entry writes take — the domain's own caps, unknown keys
   * refused (`INVALID_BODY`). */
  const knowledgeEntryBody: Json = {
    type: 'object',
    required: ['topic', 'content'],
    additionalProperties: false,
    properties: {
      topic: { type: 'string', minLength: 1, maxLength: TOPIC_MAX_LENGTH },
      content: {
        type: 'string',
        minLength: 1,
        maxLength: CONTENT_MAX_LENGTH,
        description: 'Markdown',
      },
    },
  };

  paths['/api/v1/knowledge-entries'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'List knowledge entries',
      description:
        'Newest first; `cursor` is the previous page’s `continueCursor`.',
      operationId: 'listKnowledgeEntries',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('status', '`active` (default) or `superseded`'),
      ],
      responses: {
        '200': jsonResponse('Paginated entries', pageOf(ref('KnowledgeEntry'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Knowledge'],
      summary: 'Create a knowledge entry',
      description:
        'Charged against the per-organization `knowledge:mutate` budget ' +
        'the in-app editor shares.',
      operationId: 'createKnowledgeEntry',
      security: sec,
      requestBody: jsonBody(knowledgeEntryBody),
      responses: {
        '201': createdId('Created — the entry’s id'),
        '409': errorResponse(
          'An active entry with this topic exists (`KNOWLEDGE_ENTRY_DUPLICATE`)',
        ),
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
        '200': jsonResponse('The entry', ref('KnowledgeEntry')),
        '404': errorResponse('Entry not found (`KNOWLEDGE_ENTRY_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Knowledge'],
      summary: 'Supersede a knowledge entry',
      description:
        'Entries are immutable: an update writes a NEW row and answers its ' +
        'id; the old row becomes `superseded`. Both `topic` and `content` ' +
        'are required. Only the ACTIVE row of a topic takes an update — a ' +
        'superseded row answers 409 naming the row that replaced it.',
      operationId: 'updateKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      requestBody: jsonBody(knowledgeEntryBody),
      responses: {
        '200': jsonResponse('The NEW row', {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
        '404': errorResponse('Entry not found (`KNOWLEDGE_ENTRY_NOT_FOUND`)'),
        '409': errorResponse(
          'Entry is not active — it was superseded (`KNOWLEDGE_ENTRY_SUPERSEDED`), ' +
            'or the new topic collides with another active entry ' +
            '(`KNOWLEDGE_ENTRY_DUPLICATE`)',
        ),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Knowledge'],
      summary: 'Delete a knowledge entry',
      description:
        'What a delete removes depends on the row it names. The ACTIVE row ' +
        'is the fact itself: deleting it retires the whole topic — every ' +
        'version is deleted and the Knowledge Hub document behind it is ' +
        'moved to trash. A SUPERSEDED row is history: deleting it prunes ' +
        'that one version and leaves the active fact and its document ' +
        'untouched, so a retention job can walk `?status=superseded` and ' +
        'delete row by row.',
      operationId: 'deleteKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse(
          'Entry not found, including one already deleted (`KNOWLEDGE_ENTRY_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
  };

  for (const scope of [
    { path: '/api/v1/knowledge/search', project: false },
    { path: '/api/v1/projects/{id}/knowledge/search', project: true },
  ]) {
    paths[scope.path] = {
      post: {
        tags: ['Knowledge'],
        summary: scope.project
          ? 'Search a project’s indexed files'
          : 'Search visible Hub knowledge and organization websites',
        description: scope.project
          ? 'Searches only indexed files attached to the URL project (project files index only when bound with `skipRagIndexing: false`). Requires project read access; archived project files remain searchable. Corpus defaults to documents and accepts only documents. Hub files, other projects, websites and conversation attachments are excluded.'
          : 'Read-only semantic search as the key holder. Document results come from the visible Knowledge Hub and teams — file-backed documents only; a document created with inline `content` and no `fileId` is never indexed and cannot match. Web results come from the organization’s registered websites. Every project and conversation attachment is excluded. Corpus defaults to all.',
        operationId: scope.project
          ? 'searchProjectKnowledge'
          : 'searchKnowledge',
        security: sec,
        parameters: [
          orgSlugHeaderParam,
          ...(scope.project ? [pathParam('id', 'Project ID')] : []),
        ],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 2000 },
            corpus: {
              type: 'string',
              enum: scope.project ? ['documents'] : ['documents', 'web', 'all'],
              default: scope.project ? 'documents' : 'all',
            },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
            minSimilarity: { type: 'number', minimum: 0, maximum: 1 },
          },
        }),
        responses: {
          '200': jsonResponse(
            'Hits and diagnostics',
            ref('KnowledgeSearchResult'),
          ),
          ...(scope.project
            ? { '404': errorResponse('Project missing or invisible') }
            : {}),
          '409': errorResponse(
            'The organization cannot search until an admin acts: no ' +
              'embedding model is configured (`EMBEDDING_NOT_CONFIGURED`), ' +
              'or the embedding provider refused for account reasons — ' +
              'balance spent or the plan excludes the model ' +
              '(`EMBEDDING_CREDIT_EXHAUSTED`), or it rejected the ' +
              'organization’s credential or refused it the model ' +
              '(`EMBEDDING_CREDENTIAL_REJECTED`). Not retryable by waiting.',
          ),
          '503': errorResponse(
            'The embedding provider could not serve the request ' +
              '(`EMBEDDING_UPSTREAM_ERROR`) — a transient upstream failure; ' +
              '`Retry-After` names the wait, retry with backoff',
          ),
          ...standardErrors,
        },
      },
    };
  }

  // ── MCP ───────────────────────────────────────────────────────────────────

  const jsonRpcId: Json = {
    oneOf: [{ type: 'string' }, { type: 'integer' }],
    description: 'The request id — a string or a number',
  };
  const jsonRpcMessage: Json = {
    type: 'object',
    required: ['jsonrpc', 'method'],
    properties: {
      jsonrpc: { type: 'string', enum: ['2.0'] },
      id: {
        ...jsonRpcId,
        description:
          'The request id — a string or a number; omit it for a notification, which is acknowledged with 202 and never answered',
      },
      method: str,
      params: obj,
    },
  };
  const jsonRpcResult: Json = {
    type: 'object',
    required: ['jsonrpc', 'id', 'result'],
    properties: {
      jsonrpc: { type: 'string', enum: ['2.0'] },
      id: jsonRpcId,
      result: obj,
    },
  };
  const jsonRpcError: Json = {
    type: 'object',
    required: ['jsonrpc', 'id', 'error'],
    properties: {
      jsonrpc: { type: 'string', enum: ['2.0'] },
      id: {
        anyOf: [
          { type: 'string', nullable: true },
          { type: 'integer', nullable: true },
        ],
        description:
          'The request id, or null when the request could not be read (a parse error, an invalid envelope)',
      },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'integer',
            description:
              '-32700 parse error, -32600 invalid request, -32601 unknown method, -32602 invalid params (an unknown tool, or arguments that do not match the advertised input schema), -32000 a tool call in a batch that exceeded the key holder’s request budget (`data.retryAfterMs` names the wait)',
          },
          message: str,
        },
      },
    },
  };
  const jsonRpcReply: Json = { oneOf: [jsonRpcResult, jsonRpcError] };

  paths['/api/v1/mcp'] = {
    post: {
      tags: ['MCP'],
      summary: 'The platform MCP endpoint',
      description:
        'JSON-RPC over HTTP (MCP protocol 2025-06-18, or 2025-03-26 when the ' +
        'client proposes it; JSON responses only, no SSE). One message per ' +
        'request, or a JSON-RPC batch answered as an array. Authenticate with ' +
        'the same Bearer org API key as the REST API. Call `tools/list` for ' +
        'the tool inventory — automation authoring, run and trigger management, ' +
        'and the organization’s capability surface — and the `get_docs` tool ' +
        'for the in-band authoring reference. Tool arguments are checked ' +
        'against the advertised input schema. GET answers 405. See the MCP ' +
        'endpoint page in the developer docs for the full tour.',
      operationId: 'mcp',
      security: sec,
      requestBody: jsonBody({
        oneOf: [
          jsonRpcMessage,
          {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: jsonRpcMessage,
            description:
              'A JSON-RPC batch — at most 20 messages; every tool call beyond the first draws from the request budget like a request of its own',
          },
        ],
      }),
      responses: {
        '200': jsonResponse(
          'The JSON-RPC reply — a result or an error envelope; an array of them for a batch. A tool call that failed is a result whose `isError` is true, never an error envelope.',
          {
            oneOf: [jsonRpcReply, { type: 'array', items: jsonRpcReply }],
          },
        ),
        '202': {
          description:
            'A notification (a message without an id), or a batch of notifications alone — acknowledged, no body',
        },
        '400': jsonResponse(
          'The body could not be acted on: not JSON (-32700), not a JSON-RPC 2.0 message, an id that is not a string or a number, an empty batch, or an unsupported `MCP-Protocol-Version` header (-32600)',
          jsonRpcError,
        ),
        '401': standardErrors['401'],
        '429': standardErrors['429'],
      },
    },
  };

  // ── Inbound automation webhook ────────────────────────────────────────────

  for (const projectScoped of [false, true]) {
    const path = projectScoped
      ? '/api/projects/{id}/automations/webhook/{token}'
      : '/api/automations/webhook/{token}';
    paths[path] = {
      post: {
        tags: ['Automations'],
        summary: projectScoped
          ? 'Fire a project webhook trigger'
          : 'Fire an organization webhook trigger',
        description:
          (projectScoped
            ? 'Starts a run in the URL project. The automation must be installed ' +
              'in that existing, active project in the token’s organization. ' +
              'Scope is rechecked before returning a duplicate delivery. '
            : 'Starts a run without a project. Automations installed in any ' +
              'project require the project webhook URL; this URL refuses them. ') +
          'The URL token is the credential (minted by `PUT /api/v1/automations/' +
          '{name}/triggers`, shown once, stored hashed); no API key or organization ' +
          'header is needed. The `projectId` query parameter is rejected. The body ' +
          '(≤256 KiB) becomes `payload` in the run input ' +
          '`{trigger: "webhook", payload: <body>}`. Any JSON value is accepted as ' +
          'event data; non-JSON bodies become text. Delivery IDs are remembered ' +
          'for 24 hours, or byte-identical bodies for two minutes when no ID is ' +
          'supplied. Deduplication includes the URL project.',
        operationId: projectScoped
          ? 'fireProjectAutomationWebhook'
          : 'fireAutomationWebhook',
        security: [],
        parameters: [
          ...(projectScoped
            ? [
                pathParam(
                  'id',
                  'The project where this automation is installed',
                ),
              ]
            : []),
          pathParam('token', 'The webhook token'),
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description:
              'A stable delivery ID. Recognized vendor delivery headers are also accepted.',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': { schema: {} },
            'text/plain': { schema: { type: 'string' } },
          },
        },
        responses: {
          '202': jsonResponse(
            'Run started, or the original delivery returned',
            {
              type: 'object',
              additionalProperties: false,
              required: ['runId'],
              properties: {
                runId: { type: 'string' },
                duplicate: { type: 'boolean', enum: [true] },
              },
            },
          ),
          '404': errorResponse('Unknown or disabled token (`NOT_FOUND`)'),
          '400': errorResponse(
            'Invalid project scope (the automation’s own code, e.g. ' +
              '`AUTOMATION_PROJECT_FORBIDDEN`), a forbidden `projectId` query ' +
              'parameter (`INVALID_QUERY`), or input that does not match the ' +
              'automation inputs schema',
          ),
          '409': errorResponse(
            'The automation has no deployed version (`AUTOMATION_NOT_DEPLOYED`)',
          ),
          '413': errorResponse('Body exceeds 256 KiB (`BODY_TOO_LARGE`)'),
        },
      },
    };
  }

  // The tenant header is a property of the door, not of a family: every
  // `/api/v1` operation reads it (a multi-organization key MUST send it on
  // writes and on every project, task and conversation call; a
  // single-organization key may omit it anywhere), so every operation
  // documents it — the builders above that already name it, with their own
  // stricter wording, keep theirs.
  for (const [path, operations] of Object.entries(paths)) {
    if (!path.startsWith('/api/v1/')) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = operation as { parameters?: Json[] };
      const parameters = op.parameters ?? [];
      const declared = parameters.some(
        (parameter) =>
          parameter.in === 'header' &&
          parameter.name === orgSlugHeaderParam.name,
      );
      if (!declared) op.parameters = [orgSlugHeaderParam, ...parameters];
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Tale Platform API',
      version: '1.3.0',
      contact: { name: 'Tale', url: 'https://tale.dev' },
      description: `
REST access to a Tale deployment: knowledge resources, automations and their
runs, chat threads, agents, and skills — plus an MCP endpoint exposing the
same platform to MCP clients.

Project resources use \`/api/v1/projects/{id}/...\`: tasks, agents, files,
chats, installed automations, runs and project document search. Their project
comes from the URL; request bodies refuse projectId. Global chat and run URLs
serve only resources without a project. Global document URLs serve the
Knowledge Hub; global knowledge search excludes projects and conversations.

## Authentication

Every \`/api/v1\` request carries an organization API key (create one in
Settings → API):

\`\`\`
Authorization: Bearer tale_...
\`\`\`

Inbound automation webhooks authenticate with their URL token.

If you belong to several organizations, send \`X-Organization-Slug\` to
select one explicitly. Project reads require this header too.

## Errors

Non-2xx responses carry a flat envelope: \`{"error": "<message>"}\` (domain
refusals add a stable \`code\`).

## Pagination

The keyset-paginated lists — contacts, products, documents, knowledge
entries, threads, messages, websites — take \`cursor\` + \`limit\` and answer
\`{page, isDone, continueCursor}\`; pass \`continueCursor\` back as \`cursor\`
until \`isDone\`. Lists that answer a named array (\`{automations}\`,
\`{runs}\`, \`{agents}\`, \`{skills}\`, \`{folders}\`, \`{comments}\`) are complete
sets or bounded windows, except comments, which include isDone and
continueCursor for older pages. Project files answer \`{files, cursor?}\`.

## Rate limits

Budgets are keyed on the key holder — the user the key acts as — never on a
network address: reads and CRUD share one bucket (120/min, burst 200);
starting an automation run, sending a chat message and starting a task
workflow share a tighter one (20/min, burst 40); the project upload flow has
its own (240/min, burst 300). A key that fails to authenticate is throttled
per source IP instead (20/min, burst 40), so strangers never draw from a key
holder's budget. A 429 carries \`Retry-After\` in whole seconds.

## Quick start

\`\`\`bash
# 1. List automations installed in an existing project
curl -H "Authorization: Bearer tale_..." \\
  -H "X-Organization-Slug: <orgSlug>" \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations"

# 2. Start a deployed automation in that project
curl -X POST -H "Authorization: Bearer tale_..." \\
  -H "X-Organization-Slug: <orgSlug>" \\
  -H "Content-Type: application/json" -d '{"input": {}}' \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations/billing__dunning/runs"

# 3. Poll it
curl -H "Authorization: Bearer tale_..." \\
  -H "X-Organization-Slug: <orgSlug>" \\
  "https://your-instance.com/api/v1/projects/<projectId>/runs/<runId>"
\`\`\`
`.trim(),
    },
    // The static document carries a template; a running instance's
    // `/openapi.json` answers its own origin here, filled in per request.
    servers: [
      {
        url: '{origin}',
        description:
          'The deployment this document describes — `GET /openapi.json` on a running instance fills it in',
        variables: {
          origin: {
            default: 'https://your-host.example.com',
            description: 'Scheme and host of the Tale deployment',
          },
        },
      },
    ],
    security: sec,
    tags: [
      {
        name: 'Organization',
        description:
          'The key holder and the organizations it may act in — where a ' +
          'multi-organization client learns the slug to send.',
      },
      { name: 'Documents', description: 'Documents in the knowledge base.' },
      { name: 'Websites', description: 'Crawled website sources.' },
      {
        name: 'Browser sessions',
        description:
          'The warmed browser-session pool behind video-link ingestion.',
      },
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
      { name: 'Agents', description: 'Agents belonging to one project.' },
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
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string', description: 'What went wrong' },
            code: {
              type: 'string',
              enum: [...REST_ERROR_CODES],
              description:
                'A stable refusal code — every refusal the door itself makes carries one, and so does every domain refusal it lets through. The set is additive: a new code is a minor change, so treat a value you do not know as a generic refusal of the status you got.',
            },
            data: {
              type: 'object',
              properties: {
                retryAfterMs: {
                  type: 'number',
                  description: 'Wait in milliseconds for RATE_LIMITED',
                },
                issues: {
                  type: 'array',
                  description:
                    'For INVALID_BODY: every problem the body’s schema found (at most 20), each naming the field and the reason; `error` repeats the first one',
                  items: {
                    type: 'object',
                    required: ['path', 'message'],
                    properties: {
                      path: {
                        type: 'string',
                        description:
                          'The field, dotted for nesting (`address.city`, `contacts.2.email`); empty for a problem with the body as a whole',
                      },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },

        // ── Documents ──
        Document: {
          type: 'object',
          required: ['id', 'title', 'createdBy', 'createdAt', 'updatedAt'],
          properties: {
            id: str,
            title: str,
            content: nullable({
              ...str,
              description:
                'Inline text; null for blob-backed documents and in listings',
            }),
            fileId: nullable({ ...str, description: 'The blob reference' }),
            mimeType: nullable(str),
            extension: nullable(str),
            sourceProvider: nullable(str),
            teamId: nullable(str),
            folderId: nullable(str),
            metadata: nullable(obj),
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        DocumentInput: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 512 },
            content: { type: 'string', maxLength: 5_000_000 },
            fileId: {
              type: 'string',
              maxLength: 2048,
              description:
                'The metadata ID of the key holder’s own unbound upload in this organization',
            },
            mimeType: { type: 'string', maxLength: 255 },
            extension: { type: 'string', maxLength: 32 },
            sourceProvider: { type: 'string', maxLength: 64 },
            metadata: obj,
            teamId: { type: 'string', maxLength: 128 },
            folderId: { type: 'string', maxLength: 64 },
          },
        },
        DocumentPatch: {
          type: 'object',
          additionalProperties: false,
          description:
            'Every field optional; null clears a nullable field. Applies only to Knowledge Hub documents.',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 512 },
            content: nullable({ type: 'string', maxLength: 5_000_000 }),
            metadata: nullable(obj),
            mimeType: nullable({ type: 'string', maxLength: 255 }),
            extension: nullable({ type: 'string', maxLength: 32 }),
            sourceProvider: nullable({ type: 'string', maxLength: 64 }),
            teamId: nullable({ type: 'string', maxLength: 128 }),
            folderId: nullable({ type: 'string', maxLength: 64 }),
          },
        },

        // ── Websites ──
        Website: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'domain',
            'scanInterval',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            domain: str,
            kind: nullable({ type: 'string', enum: ['site', 'list'] }),
            title: nullable(str),
            description: nullable(str),
            scanInterval: str,
            lastScannedAt: nullable({ ...num, description: 'Epoch ms' }),
            status: nullable(str),
            pageCount: nullable(int),
            crawledPageCount: nullable(int),
            metadata: nullable(obj),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        WebsiteInput: {
          type: 'object',
          required: ['domain', 'scanInterval'],
          additionalProperties: false,
          properties: {
            domain: {
              ...str,
              maxLength: 2048,
              description:
                'A public hostname or http(s) URL (`docs.example.com`, ' +
                '`https://www.example.com/docs`); the host is what is ' +
                'registered. Loopback, link-local, private-network and cloud ' +
                'metadata hosts are refused — the crawler dials the target ' +
                'from inside the deployment’s network.',
            },
            title: { ...str, maxLength: 200 },
            description: { ...str, maxLength: 2000 },
            scanInterval: {
              type: 'string',
              enum: [...SCAN_INTERVAL_VALUES],
              description: 'How often the site is re-crawled',
            },
            urls: {
              type: 'array',
              items: { ...str, maxLength: 2048 },
              maxItems: 10_000,
              description:
                'Registers a curated URL list on the domain instead of a ' +
                'whole-site crawl. Every entry must be an http(s) URL on the ' +
                'domain or its www/apex sibling; re-posting merges new URLs ' +
                'into the existing list and answers 200 with the existing id.',
            },
          },
        },
        WebsitePatch: {
          type: 'object',
          additionalProperties: false,
          description:
            'The domain is immutable after create (the crawl registration ' +
            'is keyed by it): a body carrying `domain` is refused with 400 ' +
            '`WEBSITE_DOMAIN_IMMUTABLE` — delete the website and re-add it ' +
            'under the new domain.',
          properties: {
            title: { ...str, maxLength: 200 },
            description: { ...str, maxLength: 2000 },
            scanInterval: {
              type: 'string',
              enum: [...SCAN_INTERVAL_VALUES],
            },
          },
        },
        WebsitePage: {
          type: 'object',
          required: [
            'url',
            'title',
            'wordCount',
            'status',
            'contentHash',
            'lastCrawledAt',
            'discoveredAt',
            'chunksCount',
            'indexed',
          ],
          properties: {
            url: str,
            title: nullable(str),
            wordCount: int,
            status: { ...str, description: 'The page’s crawl status' },
            contentHash: nullable(str),
            lastCrawledAt: nullable({ ...num, description: 'Epoch ms' }),
            discoveredAt: nullable({ ...num, description: 'Epoch ms' }),
            chunksCount: int,
            indexed: bool,
          },
        },
        WebsitePageList: {
          type: 'object',
          required: ['pages', 'total', 'offset', 'hasMore'],
          properties: {
            pages: { type: 'array', items: ref('WebsitePage') },
            total: int,
            offset: int,
            hasMore: bool,
          },
        },
        WebsiteSearchHit: {
          type: 'object',
          required: ['url', 'title', 'content', 'chunkIndex', 'score'],
          properties: {
            url: str,
            title: nullable(str),
            content: { ...str, description: 'The matching passage' },
            chunkIndex: int,
            score: { ...num, description: 'Relevance; higher is better' },
          },
        },
        WebsiteSearchResults: {
          type: 'object',
          required: ['results', 'total'],
          properties: {
            results: { type: 'array', items: ref('WebsiteSearchHit') },
            total: int,
          },
        },

        // ── Browser sessions ──
        BrowserSession: {
          type: 'object',
          required: [
            'id',
            'domain',
            'label',
            'status',
            'expiresAt',
            'lastUsedAt',
            'failureCount',
          ],
          properties: {
            id: str,
            domain: str,
            label: nullable(str),
            status: {
              type: 'string',
              enum: ['healthy', 'cooling', 'expired'],
              description:
                'healthy = claimable; cooling = blocked once, recovers after ' +
                'a quiet period; expired = three strikes or past its TTL',
            },
            expiresAt: { ...num, description: 'Epoch ms' },
            lastUsedAt: nullable({
              ...num,
              description: 'Epoch ms of the last claim',
            }),
            failureCount: int,
          },
        },
        BrowserSessionImport: {
          type: 'object',
          required: ['domain', 'cookiesJar'],
          properties: {
            domain: {
              ...str,
              description:
                'The hostname the jar was warmed for (lower-cased on import)',
            },
            cookiesJar: {
              ...str,
              description: 'A Netscape-format cookie jar, at most 1 MB',
            },
            userAgent: str,
            visitorData: str,
            poToken: str,
            label: str,
            ttlMs: {
              ...int,
              description: 'Lifetime in milliseconds (default 14 days)',
            },
          },
        },
        // ── Products ──
        Product: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'name',
            'tags',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            name: str,
            description: nullable(str),
            imageUrl: nullable(str),
            stock: nullable(num),
            price: nullable(num),
            currency: nullable(str),
            category: nullable(str),
            tags: strArray,
            status: nullable(str),
            translations: nullable({
              type: 'array',
              description: 'Per-language overrides of the catalog fields',
              items: {
                type: 'object',
                required: ['language'],
                properties: {
                  language: {
                    ...str,
                    description: 'A BCP 47 language tag (`de`, `fr-CH`)',
                  },
                  name: str,
                  description: str,
                  category: str,
                  tags: strArray,
                  metadata: obj,
                },
              },
            }),
            externalId: nullable(str),
            metadata: nullable(obj),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        ProductInput: {
          type: 'object',
          description:
            '`name` is required on create; every field is optional on update. ' +
            'Unknown keys are refused (`INVALID_BODY`).',
          additionalProperties: false,
          properties: {
            name: { ...str, minLength: 1, maxLength: PRODUCT_NAME_MAX },
            description: { ...str, maxLength: PRODUCT_DESCRIPTION_MAX },
            imageUrl: { ...str, maxLength: PRODUCT_IMAGE_URL_MAX },
            stock: safeNumber,
            price: safeNumber,
            currency: {
              ...str,
              maxLength: PRODUCT_CURRENCY_MAX,
              description: 'ISO 4217 code',
            },
            category: { ...str, maxLength: PRODUCT_CATEGORY_MAX },
            tags: {
              type: 'array',
              items: { ...str, maxLength: PRODUCT_TAG_MAX },
              maxItems: PRODUCT_TAGS_MAX,
            },
            status: { type: 'string', enum: [...PRODUCT_STATUSES] },
            externalId: { ...str, maxLength: PRODUCT_EXTERNAL_ID_MAX },
            metadata: obj,
          },
        },
        ProductPatch: {
          type: 'object',
          description:
            'Every field optional. Send `expectedUpdatedAt` from the last ' +
            'product read to update only that revision: a stale one answers ' +
            '409 `PRODUCT_STALE` without changing any field, and every ' +
            'successful update advances `updatedAt`.',
          additionalProperties: false,
          properties: {
            name: { ...str, minLength: 1, maxLength: PRODUCT_NAME_MAX },
            description: { ...str, maxLength: PRODUCT_DESCRIPTION_MAX },
            imageUrl: { ...str, maxLength: PRODUCT_IMAGE_URL_MAX },
            stock: safeNumber,
            price: safeNumber,
            currency: {
              ...str,
              maxLength: PRODUCT_CURRENCY_MAX,
              description: 'ISO 4217 code',
            },
            category: { ...str, maxLength: PRODUCT_CATEGORY_MAX },
            tags: {
              type: 'array',
              items: { ...str, maxLength: PRODUCT_TAG_MAX },
              maxItems: PRODUCT_TAGS_MAX,
            },
            status: { type: 'string', enum: [...PRODUCT_STATUSES] },
            externalId: { ...str, maxLength: PRODUCT_EXTERNAL_ID_MAX },
            metadata: obj,
            expectedUpdatedAt: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
              description:
                'The `updatedAt` of the revision this update is based on',
            },
          },
        },

        // ── The key holder ──
        Me: {
          type: 'object',
          required: ['user', 'organization', 'organizations'],
          properties: {
            user: {
              type: 'object',
              required: ['id', 'email'],
              properties: { id: str, email: str },
            },
            organization: {
              type: 'object',
              description: 'The organization this request resolved to',
              required: ['id', 'slug', 'role'],
              properties: {
                id: str,
                slug: {
                  ...str,
                  description: 'The `X-Organization-Slug` value for it',
                },
                role: str,
              },
            },
            organizations: {
              type: 'array',
              description:
                'Every organization the key holder belongs to (disabled memberships excluded)',
              items: {
                type: 'object',
                required: ['id', 'slug', 'name', 'role'],
                properties: {
                  id: str,
                  slug: nullable(str),
                  name: str,
                  role: str,
                },
              },
            },
          },
        },

        // ── Contacts ──
        Contact: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'source',
            'tags',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            name: nullable(str),
            email: nullable(str),
            phone: nullable(str),
            externalId: nullable(str),
            source: str,
            locale: nullable(str),
            address: nullable(obj),
            tags: strArray,
            metadata: nullable(obj),
            notes: nullable(str),
            lifecycleStatus: nullable(str),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        ContactInput: {
          type: 'object',
          description:
            'Unknown keys are refused (`INVALID_BODY`). A create needs at ' +
            'least one of `name`, `email` or `externalId` to file the ' +
            'contact under.',
          additionalProperties: false,
          properties: contactInputProperties,
        },
        ContactPatch: {
          type: 'object',
          description:
            'Every field optional. Send `expectedUpdatedAt` from the last ' +
            'contact read to update only that revision: a stale one answers ' +
            '409 `CONTACT_STALE` without changing any field.',
          additionalProperties: false,
          properties: {
            ...contactInputProperties,
            expectedUpdatedAt: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
              description:
                'The `updatedAt` of the revision this update is based on',
            },
          },
        },
        BulkCreateResult: {
          type: 'object',
          required: ['success', 'failed', 'created', 'errors'],
          description:
            'A body the schema refuses fails the whole call with 400; a row ' +
            'the directory refuses (a duplicate email or external id) fails ' +
            'that row alone and is listed under `errors` with its code.',
          properties: {
            success: int,
            failed: int,
            created: {
              type: 'array',
              description: 'The rows that landed, by input index',
              items: {
                type: 'object',
                required: ['index', 'id'],
                properties: { index: int, id: str },
              },
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                required: ['index', 'error', 'errorCode', 'contact'],
                properties: {
                  index: int,
                  error: str,
                  errorCode: {
                    type: 'string',
                    enum: [
                      'CONTACT_DUPLICATE_EMAIL',
                      'CONTACT_DUPLICATE_EXTERNAL_ID',
                      'CONTACT_CREATE_FAILED',
                      'unknown',
                    ],
                  },
                  contact: ref('ContactInput'),
                },
              },
            },
          },
        },

        // ── Projects ──
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
          required: ['uploadId', 'url', 'method', 's3Ref', 'expiresAt'],
          properties: {
            uploadId: {
              type: 'string',
              description: 'Single-use intent to present at the bind step',
            },
            url: { type: 'string', description: 'Where to send the bytes' },
            method: { type: 'string', enum: ['PUT'] },
            s3Ref: {
              type: 'string',
              description: 'The blob reference to bind as `fileId`',
            },
            expiresAt: {
              type: 'number',
              description:
                'Epoch ms; the intent AND the signed `url` both die of old ' +
                'age after this (30 minutes from the mint)',
            },
          },
        },
        ProjectFile: {
          type: 'object',
          required: ['id', 'createdAt'],
          properties: {
            id: { type: 'string' },
            fileName: nullable(str),
            folderId: nullable(str),
            mimeType: nullable(str),
            createdAt: { type: 'number' },
          },
        },

        // ── Tasks ──
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
                'Present only when `runWorkflowSlug` was sent and the task ' +
                'was newly created: the started run’s id to poll, or null ' +
                'when the workflow did not start. Poll GET /api/v1/projects/{id}/runs/{runId}.',
            },
          },
        },

        // ── Automations ──
        AutomationSummary: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'latestVersion', 'deployedVersion', 'projectIds'],
          properties: {
            name: { type: 'string', description: 'The real `/`-slug' },
            latestVersion: int,
            deployedVersion: nullable({
              ...int,
              description: 'null while nothing is deployed',
            }),
            presentation: {
              description: 'The newest version’s display block, if authored',
            },
            projectIds: {
              type: 'array',
              items: str,
              description:
                'The projects this automation is installed in, limited to ' +
                'those the key holder can see. Empty for an ' +
                'organization-wide automation — and for one installed only ' +
                'in projects hidden from the key holder, which then refuses ' +
                'to start at the organization URL. A project-bound ' +
                'automation runs at `/api/v1/projects/{id}/automations/{name}/runs`.',
            },
          },
        },
        Automation: {
          type: 'object',
          required: [
            'name',
            'version',
            'document',
            'deployedVersion',
            'projectIds',
            'createdBy',
            'createdAt',
          ],
          properties: {
            name: { type: 'string' },
            version: { type: 'integer' },
            document: {
              type: 'object',
              description:
                'The authored content: `name`, optional `description`, ' +
                '`inputs`, `nodes` (the node grammar the MCP `get_docs` ' +
                'tool documents), optional `output` and `tests`.',
              properties: {
                version: str,
                name: str,
                description: str,
                inputs: obj,
                nodes: { type: 'array', items: obj },
                output: {},
                tests: { type: 'array', items: obj },
                ui: obj,
              },
              additionalProperties: true,
            },
            message: { type: 'string' },
            testsPassed: nullable({
              ...bool,
              description:
                'null: no verdict (no tests, or never gated); true: the ' +
                'deploy gate ran the tests and they passed; false: saved ' +
                'with failing tests',
            }),
            deployedVersion: nullable({
              ...int,
              description: 'null while nothing is deployed',
            }),
            projectIds: {
              type: 'array',
              items: str,
              description:
                'The projects this automation is installed in, limited to ' +
                'those the key holder can see',
            },
            createdBy: { type: 'string' },
            createdAt: { type: 'number' },
          },
        },
        AutomationVersion: {
          type: 'object',
          required: ['version', 'createdBy', 'createdAt'],
          properties: {
            version: int,
            message: nullable(str),
            testsPassed: nullable(bool),
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
          },
        },
        Trigger: {
          type: 'object',
          required: ['name', 'kind', 'hasToken', 'enabled'],
          properties: {
            name: str,
            kind: { type: 'string', enum: ['schedule', 'webhook', 'event'] },
            cron: nullable(str),
            timezone: nullable(str),
            event: nullable(str),
            hasToken: {
              ...bool,
              description: 'A webhook secret exists (never returned here)',
            },
            enabled: bool,
            lastFiredAt: nullable({ ...num, description: 'Epoch ms' }),
          },
        },
        Run: {
          type: 'object',
          description:
            'A run in full — the same row in the runs listing and the single ' +
            'read: identity, status, input, output, trace, effects, and ' +
            'per-node checkpoints.',
          required: [
            'id',
            'organizationId',
            'name',
            'version',
            'status',
            'mode',
            'startedBy',
            'startedAt',
          ],
          properties: {
            id: { ...str, description: 'The run id (`runId` at start)' },
            organizationId: str,
            name: str,
            version: int,
            projectId: {
              ...nullable(str),
              description:
                'URL project for a project run; null for an organization run',
            },
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
            startedBy: {
              ...str,
              description: '`api-key:<userId>` for runs started here',
            },
            input: {},
            output: {},
            checkpoints: {},
            trace: {},
            effects: {},
            detail: nullable(str),
            claimEpoch: int,
            chainSeq: int,
            startedAt: { ...num, description: 'Epoch ms' },
            finishedAt: nullable({ ...num, description: 'Epoch ms' }),
          },
        },

        // ── Knowledge search ──
        KnowledgeHit: {
          type: 'object',
          required: ['id', 'corpus', 'text', 'source', 'chunkIndex', 'score'],
          properties: {
            id: {
              ...str,
              description: 'Stable row identity within its corpus',
            },
            corpus: { type: 'string', enum: ['documents', 'web'] },
            text: {
              ...str,
              description: 'The passage, contextual header included',
            },
            source: {
              type: 'object',
              required: ['ref', 'title'],
              properties: {
                ref: {
                  ...str,
                  description:
                    'The blob reference the corpus keys a document by, or the page URL for a web hit — cite `documentId` to open a document',
                },
                title: nullable(str),
                url: { ...nullable(str), description: 'Present for web pages' },
                modifiedAt: nullable({ ...num, description: 'Epoch ms' }),
                projectId: {
                  ...nullable(str),
                  description:
                    'The project the document is filed under; null for a Hub document and for a web page',
                },
                conversationId: {
                  ...nullable(str),
                  description:
                    'The conversation an emailed attachment arrived on; present only for those',
                },
                documentId: {
                  ...str,
                  description:
                    'The document `GET /api/v1/documents/{id}` takes, for a documents-corpus hit an active document exposes in the hit’s project scope; absent for web pages, thread uploads and emailed attachments',
                },
              },
            },
            chunkIndex: {
              ...int,
              description: 'Position of the passage inside its document',
            },
            offset: {
              ...int,
              description:
                'Character position of the passage within the document’s full text; absent when it cannot be established',
            },
            score: {
              ...num,
              description:
                'The producing leg’s own relevance score (BM25 or cosine); scales differ per leg',
            },
          },
        },
        KnowledgeSearchResult: {
          type: 'object',
          required: ['hits', 'diagnostics'],
          properties: {
            hits: {
              type: 'array',
              items: ref('KnowledgeHit'),
              description: 'Best first, one passage per repeated text',
            },
            diagnostics: {
              type: 'object',
              required: ['bm25', 'reranked', 'cached', 'legs'],
              properties: {
                bm25: {
                  ...bool,
                  description:
                    'False when the keyword index was unavailable and only the vector leg ran',
                },
                reranked: bool,
                cached: bool,
                legs: {
                  type: 'object',
                  additionalProperties: true,
                  description: 'Per-leg timings and counts, keyed by leg',
                },
              },
            },
          },
        },

        // ── Threads ──
        Thread: {
          type: 'object',
          required: [
            'id',
            'kind',
            'archived',
            'createdAt',
            'updatedAt',
            'generating',
          ],
          properties: {
            id: str,
            title: str,
            kind: str,
            harness: str,
            projectId: {
              ...str,
              description:
                'Present only for a thread returned through its project URL',
            },
            archived: bool,
            isShared: bool,
            generating: bool,
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        ChatModel: {
          type: 'object',
          required: [
            'id',
            'label',
            'providerSlug',
            'providerLabel',
            'contextWindow',
            'capabilities',
            'tags',
          ],
          properties: {
            id: { ...str, description: 'Send as `model`' },
            label: str,
            providerSlug: {
              ...str,
              description:
                'Send as `providerSlug` when the same id is listed under more than one provider',
            },
            providerLabel: str,
            contextWindow: {
              ...int,
              minimum: 1,
              description: 'Total context window in tokens',
            },
            maxOutputTokens: {
              ...int,
              minimum: 1,
              description: 'The largest reply the model produces, in tokens',
            },
            capabilities: {
              type: 'object',
              required: ['tools', 'vision', 'reasoning'],
              additionalProperties: false,
              properties: {
                tools: { ...bool, description: 'Accepts function tools' },
                vision: { ...bool, description: 'Reads images' },
                reasoning: {
                  ...bool,
                  description: 'Has a controllable reasoning depth',
                },
              },
            },
            pricing: {
              type: 'object',
              required: ['inputCentsPerMillion', 'outputCentsPerMillion'],
              additionalProperties: false,
              description:
                'The catalog price in US cents per million tokens; absent when the source publishes none',
              properties: {
                inputCentsPerMillion: { ...num, minimum: 0 },
                outputCentsPerMillion: { ...num, minimum: 0 },
              },
            },
            tags: {
              ...strArray,
              description:
                'The catalog’s capability tags (`chat`, `vision`, …) — an open, additive vocabulary',
            },
            default: {
              ...bool,
              description:
                'Present and true on the organization’s default pick for this key holder, when one is configured and accessible',
            },
          },
        },
        MessagePart: {
          description:
            'One ordered piece of a message, discriminated by `type`. The kinds listed are the vocabulary as of this version; the set is additive, so a client renders a kind it does not know as opaque.',
          discriminator: { propertyName: 'type' },
          oneOf: [
            {
              type: 'object',
              required: ['type', 'text'],
              properties: {
                type: { type: 'string', enum: ['text'] },
                text: str,
              },
            },
            {
              type: 'object',
              required: ['type', 'text'],
              description:
                'The model’s reasoning ahead of its reply — display-only, never replayed to the model; it may quote the assistant’s own instructions verbatim, so it is not safe to render as the answer.',
              properties: {
                type: { type: 'string', enum: ['reasoning'] },
                text: str,
              },
            },
            {
              type: 'object',
              required: ['type', 'name', 'mediaType'],
              properties: {
                type: { type: 'string', enum: ['attachment'] },
                name: str,
                mediaType: str,
                fileId: str,
                sizeBytes: int,
                url: str,
                text: { ...str, description: 'Extracted text, when any' },
              },
            },
            {
              type: 'object',
              required: ['type', 'callId', 'capabilityId', 'input'],
              properties: {
                type: { type: 'string', enum: ['tool-call'] },
                callId: str,
                capabilityId: str,
                input: {},
              },
            },
            {
              type: 'object',
              required: [
                'type',
                'callId',
                'capabilityId',
                'output',
                'structured',
              ],
              properties: {
                type: { type: 'string', enum: ['tool-result'] },
                callId: str,
                capabilityId: str,
                output: {},
                structured: {
                  ...bool,
                  description:
                    'False when the capability declares no output schema',
                },
              },
            },
            {
              type: 'object',
              required: ['type', 'approvalId', 'question'],
              properties: {
                type: { type: 'string', enum: ['approval'] },
                approvalId: str,
                question: str,
                decision: { type: 'string', enum: ['approved', 'rejected'] },
              },
            },
            {
              type: 'object',
              required: ['type', 'requestId', 'question'],
              properties: {
                type: { type: 'string', enum: ['human-input'] },
                requestId: str,
                question: str,
                questionCount: int,
                outcome: { type: 'string', enum: ['answered', 'skipped'] },
              },
            },
          ],
        },
        Message: {
          type: 'object',
          required: ['id', 'role', 'parts', 'sequence', 'status', 'createdAt'],
          properties: {
            id: str,
            role: { type: 'string', enum: ['user', 'assistant'] },
            parts: {
              type: 'array',
              items: ref('MessagePart'),
              description: 'The message parts, in order',
            },
            sequence: { ...int, description: 'The paging key' },
            status: {
              type: 'string',
              enum: ['pending', 'complete', 'failed', 'cancelled'],
              description:
                '`pending` is the placeholder a running turn fills in (the row GET …/generation names as messageId); `failed` carries `error`.',
            },
            model: str,
            providerSlug: str,
            blockedReason: str,
            error: {
              ...str,
              description: 'Why a failed turn produced no reply',
            },
            errorCode: {
              type: 'string',
              enum: [...CHAT_ERROR_CODES],
              description:
                'Stable chat error classification when available. `credit_exhausted` and `model_not_entitled` mean the provider account, not the request; neither is `rate_limited`.',
            },
            usage: {
              type: 'object',
              additionalProperties: false,
              description:
                'The token counters the finished turn recorded; absent until then',
              properties: {
                inputTokens: int,
                outputTokens: int,
                cachedInputTokens: int,
                reasoningTokens: int,
              },
            },
            createdAt: {
              ...num,
              description:
                'Epoch ms — when the row was created (for an assistant row, when its turn started)',
            },
          },
        },

        // ── Agents & skills ──
        ProjectAgentInput: projectAgentInputSpec,
        ProjectAgent: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'projectId',
            'name',
            'harness',
            'model',
            'modelProvider',
            'skills',
            'connectors',
            'tools',
            'secrets',
            'instructions',
            'createdBy',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            projectId: str,
            name: str,
            harness: str,
            model: str,
            modelProvider: nullable(str),
            skills: strArray,
            connectors: strArray,
            tools: strArray,
            secrets: {
              ...strArray,
              description:
                'Granted organization secret names. Secret values are never returned.',
            },
            instructions: nullable(str),
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        SkillSummary: {
          type: 'object',
          required: ['slug', 'description', 'visibility'],
          properties: {
            slug: str,
            description: str,
            visibility: { type: 'string', enum: ['team', 'org'] },
            teams: strArray,
            owner: str,
          },
          additionalProperties: true,
        },
        Skill: {
          type: 'object',
          description: 'The skill bundle: its summary fields plus the body',
          required: ['slug', 'description'],
          properties: {
            slug: str,
            description: str,
            body: str,
            visibility: { type: 'string', enum: ['team', 'org'] },
            teams: strArray,
          },
          additionalProperties: true,
        },

        // ── Knowledge ──
        KnowledgeEntry: {
          type: 'object',
          required: [
            'id',
            'topic',
            'content',
            'status',
            'source',
            'createdBy',
            'createdAt',
          ],
          properties: {
            id: str,
            topic: str,
            content: str,
            status: { type: 'string', enum: ['active', 'superseded'] },
            source: str,
            documentId: str,
            supersededBy: {
              ...str,
              description: 'The row that replaced this one',
            },
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
          },
        },
      },
    },
  };
}
