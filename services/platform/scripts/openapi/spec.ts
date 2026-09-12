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
  DEFAULT_SESSION_TTL_MS,
  MAX_SESSION_TTL_MS,
} from '../../backend/domains/browser_sessions/service.ts';
import {
  CONTACT_EMAIL_LOCAL_PART_MAX,
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
import { EFFORT_LEVELS } from '../../lib/chat/effort.ts';
import { CHAT_ERROR_CODES } from '../../lib/shared/chat-errors.ts';
import {
  API_EXTERNAL_ID_MAX_LENGTH,
  API_SOURCE_PATTERN,
  apiDeliveryFailureSchema,
  apiSnapshotSchema,
} from '../../lib/shared/conversations/api-sync.ts';
import { EMITTED_EVENT_TYPES } from '../../lib/shared/event-types.ts';
import { dataSourceSchema } from '../../lib/shared/schemas/common.ts';
import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_MODEL_MAX,
  projectAgentInputSchema,
} from '../../lib/shared/schemas/projects.ts';
import {
  MAX_SKILL_BODY_BYTES,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_ICON_LENGTH,
  MAX_SKILL_LABEL_LENGTH,
  MAX_SKILL_LABELS,
  MAX_SKILL_SLUG_LENGTH,
  MAX_SKILL_TEAM_ID_LENGTH,
  MAX_SKILL_TEAMS,
  SKILL_EDIT_VISIBILITIES,
  SKILL_SLUG_REGEX,
  SKILL_VISIBILITIES,
} from '../../lib/shared/schemas/skills.ts';
import { FREE_FORM_JSON_BOUNDS } from '../../lib/shared/utils/json-bounds.ts';

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

/** A door-wide refusal folded into an operation's own response of that
 * status: appended to the family's sentence when one exists, the whole
 * description otherwise. */
function withDoorRefusal(existing: Json | undefined, sentence: string): Json {
  if (existing === undefined) return errorResponse(sentence);
  const description =
    typeof existing.description === 'string' ? existing.description : '';
  return { ...existing, description: `${description}; or ${sentence}` };
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
/** A timestamp: whole epoch milliseconds — the integer every list orders
 * on and every `expectedUpdatedAt` echoes back. */
const epochMs: Json = {
  type: 'integer',
  minimum: 0,
  description: 'Epoch milliseconds',
};
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
      'values; only organization admins may change these grants, and a ' +
      'name the organization has not stored is refused ' +
      '(`PROJECT_AGENT_SECRET_UNKNOWN`), never pruned.',
  };
})();

/** The PUT body: the full configuration plus `expectedUpdatedAt`, the
 * optimistic precondition of a full replace. */
const projectAgentUpdateSpec: Json = {
  ...projectAgentInputSpec,
  properties: {
    ...(typeof projectAgentInputSpec.properties === 'object' &&
    projectAgentInputSpec.properties !== null
      ? projectAgentInputSpec.properties
      : {}),
    expectedUpdatedAt: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      description:
        'The `updatedAt` last read; a save against an agent that changed ' +
        'since answers 409 `PROJECT_AGENT_STALE` and writes nothing. ' +
        'Omitted, the save is unconditional.',
    },
  },
  description:
    'The full configuration a `PUT` replaces — `ProjectAgentInput` plus ' +
    'the optional `expectedUpdatedAt` precondition.',
};

/** A free-form object field under the bound every such field shares
 * (FREE_FORM_JSON_BOUNDS); `description` says what a PATCH does to it. */
function freeFormObject(description: string): Json {
  return {
    ...obj,
    maxProperties: FREE_FORM_JSON_BOUNDS.maxKeys,
    description:
      `${description} At most ${Math.round(FREE_FORM_JSON_BOUNDS.maxBytes / 1024)} KiB ` +
      `of JSON, ${FREE_FORM_JSON_BOUNDS.maxDepth} levels of nesting and ` +
      `${FREE_FORM_JSON_BOUNDS.maxKeys} keys in total (every nested object ` +
      'counted); a larger value answers 400 `INVALID_BODY` naming the path.',
  };
}

/** The PATCH twin of a create's properties: every field but `except`
 * takes `null`, which clears it. */
function nullableProperties(
  properties: Record<string, Json>,
  except: readonly string[],
): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => [
      key,
      except.includes(key) ? schema : nullable(schema),
    ]),
  );
}

const MERGE_ON_PATCH =
  'Free-form. On PATCH it MERGES per RFC 7396 — sent keys are set, ' +
  'omitted keys stay, a key sent as `null` is removed, and the whole field ' +
  'sent as `null` clears it.';

/** The contact write fields (`domains/contacts/input-schema.ts`), shared
 * by the create body and (made nullable) the patch body. */
const contactInputProperties: Record<string, Json> = {
  name: { ...str, maxLength: CONTACT_NAME_MAX, description: 'Trimmed' },
  email: {
    ...str,
    format: 'email',
    maxLength: CONTACT_EMAIL_MAX,
    description:
      'Trimmed and stored lowercase — a duplicate matches ' +
      'case-insensitively; the part before `@` is at most ' +
      `${CONTACT_EMAIL_LOCAL_PART_MAX} characters`,
  },
  phone: { ...str, maxLength: CONTACT_PHONE_MAX, description: 'Trimmed' },
  source: {
    type: 'string',
    enum: [...dataSourceSchema.options],
    description:
      'Where the contact came from — one of the platform’s data sources; defaults to `api_import`, and `custom` is the catch-all for anything not listed',
  },
  locale: { ...str, maxLength: CONTACT_LOCALE_MAX, description: 'Trimmed' },
  address: freeFormObject(
    'Free-form. On PATCH it is REPLACED whole — an address is a unit.',
  ),
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
      'Stored as a trimmed string. Send a source system’s id as a string: ' +
      'a number beyond 2^53 − 1 cannot be carried exactly and is refused',
  },
  tags: {
    type: 'array',
    items: { ...str, maxLength: CONTACT_TAG_MAX, description: 'Trimmed' },
    maxItems: CONTACT_TAGS_MAX,
  },
  metadata: freeFormObject(MERGE_ON_PATCH),
  notes: { ...str, maxLength: CONTACT_NOTES_MAX, description: 'Trimmed' },
};

/** The product write fields (`domains/products/input-schema.ts`), shared
 * by the create body and (made nullable) the patch body. */
const productInputProperties: Record<string, Json> = {
  name: {
    ...str,
    minLength: 1,
    maxLength: PRODUCT_NAME_MAX,
    description: 'Trimmed; a blank name is refused',
  },
  description: {
    ...str,
    maxLength: PRODUCT_DESCRIPTION_MAX,
    description: 'Trimmed',
  },
  imageUrl: {
    ...str,
    format: 'uri',
    maxLength: PRODUCT_IMAGE_URL_MAX,
    description:
      'An absolute http(s) URL, trimmed; any other value (a relative path, ' +
      'a `javascript:` or `ftp:` URL) answers 400',
  },
  stock: safeNumber,
  price: safeNumber,
  currency: {
    ...str,
    pattern: '^[A-Z]{3}$',
    minLength: PRODUCT_CURRENCY_MAX,
    maxLength: PRODUCT_CURRENCY_MAX,
    description:
      'An ISO 4217 code (`USD`, `EUR`) — any case in, stored uppercase; a ' +
      'code the platform does not know answers 400',
  },
  category: { ...str, maxLength: PRODUCT_CATEGORY_MAX, description: 'Trimmed' },
  tags: {
    type: 'array',
    items: { ...str, maxLength: PRODUCT_TAG_MAX, description: 'Trimmed' },
    maxItems: PRODUCT_TAGS_MAX,
  },
  status: { type: 'string', enum: [...PRODUCT_STATUSES] },
  externalId: {
    ...str,
    maxLength: PRODUCT_EXTERNAL_ID_MAX,
    description: 'Trimmed',
  },
  metadata: freeFormObject(MERGE_ON_PATCH),
};

/** The `updatedAt` precondition a CRM patch may carry. */
const expectedUpdatedAtProperty: Json = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  description: 'The `updatedAt` of the revision this update is based on',
};

/** A skill as every skill view carries it (`SkillSummaryView`): the
 * listing row and the document share these; `Skill` adds the body and the
 * file list. */
const skillSummaryProperties: Json = {
  slug: {
    ...str,
    pattern: SKILL_SLUG_REGEX.source,
    maxLength: MAX_SKILL_SLUG_LENGTH,
  },
  description: str,
  visibility: {
    type: 'string',
    enum: [...SKILL_VISIBILITIES],
    description:
      '`org` — every member; `team` — members of `teams`; `private` — retired for new skills, still carried by pre-existing bundles their owner alone sees',
  },
  teams: {
    ...strArray,
    description: 'Team ids a `team` skill is shared with; absent otherwise',
  },
  owner: { ...str, description: 'The member who owns the bundle (a user id)' },
  icon: { ...str, description: 'An Iconify id shown on the skill’s card' },
  labels: { ...strArray, description: 'Display chips on the skill’s card' },
  disableModelInvocation: {
    ...bool,
    description:
      'True when the model must not reach for the skill on its own; it stays available by explicit name',
  },
  canEdit: {
    ...bool,
    description:
      'Whether this key may edit the bundle; shipped skills are organization bundles an administrator may overwrite',
  },
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
    'The organization to operate on. STRICTLY REQUIRED on every call, reads ' +
    'included, when the key holder belongs to more than one organization — ' +
    'without it such requests are refused with 400 `ORG_SLUG_REQUIRED` (the ' +
    'dashboard’s last-active organization never steers a machine call). A ' +
    'slug that names no organization answers 404 `ORG_SLUG_INVALID`, one the ' +
    'key holder is no member of 403 `ORG_FORBIDDEN`. Single-organization keys ' +
    'may omit it. The 400 lists the slugs the key holder may send under ' +
    '`data.organizations`; `GET /api/v1/me` answers them too.',
};

// ── The spec ─────────────────────────────────────────────────────────────────

export function buildSpec(): Json {
  const paths: Record<string, Json> = {};

  /** The tenant header — the one door rule, strict on every call. */
  const conversationOrg = orgSlugHeaderParam;
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
        '(`CONTACT_NOT_FOUND`), no snapshot ever named the source ' +
        '(`CONVERSATION_SOURCE_NOT_FOUND`), or the delivery or attachment ' +
        'is absent (`DELIVERY_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`)',
    ),
    '409': errorResponse(
      'Conflicting identity, revision, or receipt: ' +
        '`CONVERSATION_SNAPSHOT_CONFLICT`, `CONVERSATION_CONTACT_CONFLICT`, ' +
        '`CONTACT_AMBIGUOUS`, `DELIVERY_UNACKNOWLEDGED`, ' +
        '`DELIVERY_RECEIPT_CONFLICT`, `DELIVERY_RETRY_UNAVAILABLE`, ' +
        '`CONVERSATION_CLOSED`',
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
          schema: { type: 'string', pattern: API_SOURCE_PATTERN.source },
        },
        {
          ...queryParam('externalId', 'Stable source conversation ID'),
          required: true,
          schema: {
            type: 'string',
            minLength: 1,
            maxLength: API_EXTERNAL_ID_MAX_LENGTH,
          },
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
        'Creates an API-channel Inbox conversation linked to exactly one contact.externalId. Source + externalId is owned by the API key user; key rotation preserves ownership. A newer integer version replaces only source-receipted messages; an older version does nothing; the same version with different content returns 409. Message IDs must be unique. A message that began life as a native Inbox reply — one this integration claimed through the deliveries lane — carries `taleMessageId`, that reply’s `messageId`, and must have been acknowledged under its `externalId` first (409 `DELIVERY_UNACKNOWLEDGED` otherwise); a message without `taleMessageId` is the source’s own, whatever `isCustomer` says. A deleted snapshot closes the source and has no messages: it is not content, so it applies at the stored version or any higher one (a source whose versions ran out can still tear its mirror down) and replays as a no-op once the source is torn down. Unacknowledged office replies are preserved. Unknown keys are refused. JSON is limited to 8 MiB.',
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
        'Claims up to 100 due replies for a source owned by this API key user — a source no snapshot ever named answers 404 `CONVERSATION_SOURCE_NOT_FOUND`, one only other service users own 403 `INTEGRATION_NOT_OWNED`, so a mistyped source never polls a healthy-looking empty queue. Claim closes undo and grants a five-minute visibility lease. Unacknowledged deliveries become eligible again after their lease/backoff in retryAt/availableAt/messageId order. Use stable messageId as the destination idempotency key and claimToken when reporting a failure. JSON is limited to 64 KiB.',
      requestBody: jsonBody({
        type: 'object',
        required: ['source'],
        additionalProperties: false,
        properties: {
          source: { type: 'string', pattern: API_SOURCE_PATTERN.source },
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
              availableAt: epochMs,
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
        additionalProperties: false,
        properties: {
          receiptId: {
            type: 'string',
            minLength: 1,
            maxLength: API_EXTERNAL_ID_MAX_LENGTH,
          },
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
      description:
        'The bytes of one attachment of a delivery this key user claimed, at its position in the delivery’s attachment list; the stored content type rides with them and the response is private and uncacheable.',
      summary: 'Download a claimed reply attachment',
      parameters: [
        conversationOrg,
        pathParam('id', 'Claimed native message ID'),
        {
          ...pathParam(
            'index',
            'Zero-based attachment position in the claimed delivery, 0..9. A segment that is not a whole number in that range names no attachment and answers 404 `ATTACHMENT_NOT_FOUND`, never 400',
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
          'No claimed delivery this user owns under the id (`DELIVERY_NOT_FOUND`), or no attachment at that position (`ATTACHMENT_NOT_FOUND`)',
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
        'Uploads at most 30 MiB to this organization and records an upload intent owned by this key user. Bind the storageId, actual size and filename in a snapshot within two hours. Previously receipted refs can be reused on later source revisions. There is no delete: a staged upload that is never bound is reclaimed lazily — after the two-hour window plus a 24-hour grace, on the next upload into the organization — while a bound ref lives and dies with its message.',
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
        'REST does not mint hub uploads; use the app to upload first. To ' +
        'put TEXT into the search corpus from REST, create a knowledge entry ' +
        'instead: `POST /api/v1/knowledge-entries` mints a file-backed, ' +
        'indexed Hub document (`sourceProvider: knowledge`, at most 8,000 ' +
        'characters, one active entry per topic). Every file-backed ' +
        'document answers its `indexing` state, so poll it after a create ' +
        'or a `retry-indexing`.',
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
        'legal hold refuses the change. Send `expectedUpdatedAt` — the ' +
        '`updatedAt` last read — to refuse a write over a concurrent edit. ' +
        'Answers 200 with the document as it now stands, so the next write ' +
        'has its `updatedAt`. A document that backs an active knowledge ' +
        'entry keeps its title, content, MIME type and extension through ' +
        'the entry (update the entry instead); a folder, team or metadata ' +
        'change goes through.',
      operationId: 'updateDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      requestBody: jsonBody(ref('DocumentPatch')),
      responses: {
        '200': jsonResponse(
          'The document as it now stands — the shape `GET` answers, `updatedAt` included',
          ref('Document'),
        ),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse(
          'The record is protected (`DOCUMENT_RECORD_PROTECTED`); the document changed since it was read (`DOCUMENT_STALE` — reload and merge); or it backs an active knowledge entry and the change touches its title, content, MIME type or extension (`DOCUMENT_HAS_KNOWLEDGE_ENTRY`, `data.entryId` names the entry to update instead)',
        ),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Documents'],
      summary: 'Delete document',
      description:
        'Permanent deletion of a Knowledge Hub document; project files return 404. Role gate, controlled-record protection, ' +
        'legal holds, sync stop and the audit row, then the purge. A ' +
        'document that backs an active knowledge entry is refused — delete ' +
        'the entry (`DELETE /api/v1/knowledge-entries/{id}`), which retires ' +
        'every version of its topic and trashes this document.',
      operationId: 'deleteDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse(
          'A protected record (`DOCUMENT_RECORD_PROTECTED`), a legal hold (`LEGAL_HOLD_ACTIVE`), or a document that backs an active knowledge entry (`DOCUMENT_HAS_KNOWLEDGE_ENTRY`, `data.entryId` names it — delete the entry instead)',
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
      description:
        'The organization’s registered websites, newest first, keyset-paginated; `status` and `scanInterval` narrow the page.',
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
      description:
        'One registered website with its crawl status, page counts and scan interval.',
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
      description:
        'Answers the website as it now stands, so the next write has its ' +
        '`updatedAt` and a client can watch `status` without a second read.',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody(ref('WebsitePatch')),
      responses: {
        '200': jsonResponse('The updated website', ref('Website')),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
        ...standardErrors,
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), or a `domain` other ' +
            'than the stored one (`WEBSITE_DOMAIN_IMMUTABLE`)',
        ),
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

  const browserSessionGate = errorResponse(
    'The key holder may not write to the pool (`FORBIDDEN_INSTANCE_ADMIN` ' +
      'or `FORBIDDEN_DEPLOYMENT_EDITOR`)',
  );

  paths['/api/v1/browser-sessions/import'] = {
    post: {
      tags: ['Browser sessions'],
      summary: 'Import a browser session',
      description:
        'Adds a warmed cookie jar to the pool for one domain; the jar is ' +
        'encrypted before it is stored. Restricted to organization ' +
        'administrators whose e-mail is on the deployment editor allowlist ' +
        '(`TALE_DEPLOYMENT_CONFIG_ADMINS`) — anyone else answers 403 with a ' +
        '`code` naming the gate that refused, before the body is read. The ' +
        'domain is normalized to its hostname (`https://Example.COM/path` ' +
        'and `example.com` are one host) and held to the crawl-target ' +
        'policy: loopback, link-local, private-network and cloud-metadata ' +
        'hosts answer 400 `INVALID_SESSION`. A session lives 14 days unless ' +
        '`ttlMs` says otherwise, and never longer than 180 days; ' +
        '`DELETE /api/v1/browser-sessions/{id}` revokes it earlier.',
      operationId: 'importBrowserSession',
      security: sec,
      requestBody: jsonBody(ref('BrowserSessionImport')),
      responses: {
        '201': jsonResponse('Imported — the session’s id', {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: str },
        }),
        '400': errorResponse(
          'Invalid body (`INVALID_BODY` — a blank domain or jar, a lifetime ' +
            'past 180 days, an unknown key) or a domain no session can be ' +
            'warmed for (`INVALID_SESSION`)',
        ),
        '403': browserSessionGate,
        '401': standardErrors['401'],
        '429': standardErrors['429'],
      },
    },
  };

  paths['/api/v1/browser-sessions/{id}'] = {
    delete: {
      tags: ['Browser sessions'],
      summary: 'Revoke a browser session',
      description:
        'Removes one imported session — the jar is gone at once, whatever ' +
        'its lifetime — behind the same gate as the import. An id the ' +
        'organization does not hold answers 404.',
      operationId: 'deleteBrowserSession',
      security: sec,
      parameters: [pathParam('id', 'The session id the import answered')],
      responses: {
        '204': noContent('Revoked'),
        '403': browserSessionGate,
        '404': errorResponse(
          'No such session in this organization (`BROWSER_SESSION_NOT_FOUND`)',
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
      description:
        'Create a product in the organization’s catalog: `name` is required and unique per organization regardless of case (409 `DUPLICATE_PRODUCT_NAME`), `externalId` unique when given (409 `DUPLICATE_PRODUCT_EXTERNAL_ID`).',
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
          'Duplicate name (`DUPLICATE_PRODUCT_NAME`) or external id (`DUPLICATE_PRODUCT_EXTERNAL_ID`)',
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
      description:
        'One product by id; a product in the trash or in another organization answers 404 `PRODUCT_NOT_FOUND`.',
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
      description:
        'Update the fields sent and keep the rest — `metadata` merges (RFC 7396), `null` clears — and answer the product as it now stands.',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      requestBody: jsonBody(ref('ProductPatch')),
      responses: {
        '200': jsonResponse('The updated product', ref('Product')),
        '404': errorResponse('Product not found (`PRODUCT_NOT_FOUND`)'),
        '409': errorResponse(
          'Duplicate name (`DUPLICATE_PRODUCT_NAME`) or external id ' +
            '(`DUPLICATE_PRODUCT_EXTERNAL_ID`), or a stale `expectedUpdatedAt` ' +
            '(`PRODUCT_STALE`)',
        ),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Products'],
      summary: 'Delete product',
      operationId: 'deleteProduct',
      description:
        'Move the product to the trash; a product already there answers 404 `PRODUCT_NOT_FOUND`.',
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
      description:
        'One contact by id; a contact in the trash or in another organization answers 404 `CONTACT_NOT_FOUND`.',
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
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), or a patch that ' +
            'would clear the last of `name`, `email` and `externalId` ' +
            '(`CONTACT_IDENTITY_REQUIRED`)',
        ),
      },
    },
    delete: {
      tags: ['Contacts'],
      summary: 'Delete contact',
      operationId: 'deleteContact',
      description:
        'Move the contact to the trash, which frees its email and external id for a new contact; a contact already there answers 404 `CONTACT_NOT_FOUND`.',
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
      summary: 'List projects, or look one up by external item id',
      description:
        'Two doors in one. With `externalItemId`: a LOOKUP answering at ' +
        'most one project — the key is unique per organization and is ' +
        'compared after NFC normalization and trimming, the form the create ' +
        'stored it in; a project the key holder cannot see answers the same ' +
        'empty list as no match, and a lookup takes no `cursor`, `limit` or ' +
        '`archived` (400 `INVALID_QUERY`). Without it: the LIST of every ' +
        'project the key holder can see, newest first, keyset-paged like the ' +
        'project files listing — `{projects, isDone, cursor?}`, pass `cursor` ' +
        'back unchanged until `isDone`. Archived projects are excluded ' +
        'unless `archived` says `include` or `only`. Either way a row ' +
        'carries `archivedAt` when the project is archived, so a worker can ' +
        'detect an archived project holding its key. Shares the general REST ' +
        'bucket (120/min, keyed on the key holder).',
      operationId: 'listProjects',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        queryParam(
          'externalItemId',
          'The caller-owned external key the project was created with — ' +
            'compared after NFC normalization and trimming; a value that is ' +
            'blank once trimmed is refused (400 `INVALID_QUERY`). Present, ' +
            'the answer is the lookup; absent, the list.',
        ),
        {
          ...queryParam(
            'archived',
            'Which lifecycle the list covers (list only): `exclude` (the ' +
              'default) answers active projects, `include` both, `only` ' +
              'the archived ones',
          ),
          schema: {
            type: 'string',
            enum: ['exclude', 'include', 'only'],
            default: 'exclude',
          },
        },
        ...paginationParams(100, 25, 'cursor'),
      ],
      responses: {
        '200': jsonResponse(
          'The lookup’s zero or one matching project, or one page of the list',
          {
            type: 'object',
            required: ['projects'],
            properties: {
              projects: { type: 'array', items: ref('Project') },
              isDone: {
                type: 'boolean',
                description:
                  'List only: true when no more pages remain (a lookup ' +
                  'answers `projects` alone)',
              },
              cursor: {
                type: 'string',
                description:
                  'List only: present while more pages remain — pass back ' +
                  'as `cursor`, unchanged',
              },
            },
          },
        ),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      description:
        'Requires the org editor role. `externalItemId` is an opaque ' +
        'caller-owned key, stored in one canonical form — NFC-normalized ' +
        'and trimmed, the form every lookup and duplicate check compares — ' +
        'and unique per organization regardless of lifecycle: a conflict ' +
        'against an archived project is still a 409 (delete or restore it ' +
        'first). A value that is blank once trimmed, or over-long, is a 400 ' +
        '`INVALID_BODY`. `key` (the task-identifier prefix) is derived from ' +
        'the name when omitted; a derived key that is already taken gets a ' +
        'numeric suffix, and a name no key can be derived from creates the ' +
        'project keyless — a name-only create never fails on a key the ' +
        'caller did not choose. Only an EXPLICIT `key` that is taken ' +
        'answers 409, and one outside the 2-6 letters-and-digits rule 400 ' +
        '`PROJECT_KEY_INVALID`.',
      operationId: 'createProject',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            description: 'Trimmed; whitespace alone is a missing name',
          },
          externalItemId: {
            type: 'string',
            minLength: 1,
            maxLength: 256,
            description:
              'Stored and compared after NFC normalization and trimming',
          },
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
        ...standardErrors,
        '201': jsonResponse('Created project', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), or an explicit ' +
            '`key` outside the 2-6 letters-and-digits rule ' +
            '(`PROJECT_KEY_INVALID`)',
        ),
        '403': errorResponse(
          'The key holder is not an org editor (`ROLE_FORBIDDEN`)',
        ),
        '409': errorResponse(
          'Duplicate externalItemId (`PROJECT_DUPLICATE_EXTERNAL_ID`) or ' +
            'an explicit project key that is taken (`PROJECT_KEY_TAKEN`)',
        ),
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
    patch: {
      tags: ['Projects'],
      summary: 'Archive or restore a project',
      description:
        'The lifecycle toggle: `archived: true` archives the project, ' +
        '`false` restores it — the same action as the app, so it requires ' +
        'an organization admin (403 `ROLE_FORBIDDEN` otherwise); a project ' +
        'already in the requested state answers 200 unchanged. Archiving ' +
        'keeps the project and everything in it readable through this door ' +
        'and refuses every write on it (403 `PROJECT_ARCHIVED`); its ' +
        '`externalItemId` stays taken until the project is deleted. An ' +
        'invisible or absent project answers the opaque 404.',
      operationId: 'setProjectArchived',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['archived'],
        properties: { archived: bool },
      }),
      responses: {
        '200': jsonResponse('The project as it now stands', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '403': errorResponse(
          'The key holder is not an organization admin (`ROLE_FORBIDDEN`)',
        ),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project',
      description:
        'The app’s project delete, for an organization admin (403 ' +
        '`ROLE_FORBIDDEN` otherwise). The optional body chooses what ' +
        'happens to the project’s content: `mode: "cascade"` (the default) ' +
        'destroys it — every document expires into the retention pipeline ' +
        '(purged after the organization’s grace window), the key holder’s ' +
        'own chats are trashed, every task is retired and its live runs ' +
        'cancelled; `mode: "detach"` releases the documents and chats into ' +
        'the organization instead. Agents and folders go with the project ' +
        'either way, and its `externalItemId` becomes free again. The ' +
        'app’s confirmation phrase (the project name) is supplied by the ' +
        'door. A cascade is charged against the per-user ' +
        '`project:delete-cascade` budget the app charges too (5/min). ' +
        'Refused as a 409, before anything is written, while an automation ' +
        'is installed in the project (`PROJECT_HAS_BOUND_AUTOMATIONS` — ' +
        '`data.automations` names them; uninstall each with `DELETE ' +
        '/api/v1/projects/{id}/automations/{name}` first), while a cascade ' +
        'would destroy a controlled record that is in review, approved or ' +
        'retains an approved version (`PROJECT_HAS_PROTECTED_RECORDS` — ' +
        '`data.documents` names them), or while a legal hold covers one of ' +
        'its documents (`PROJECT_LEGAL_HOLD`). An invisible or absent ' +
        'project answers the opaque 404.',
      operationId: 'deleteProject',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody(
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: {
              type: 'string',
              enum: ['cascade', 'detach'],
              default: 'cascade',
              description:
                'What happens to the project’s documents and chats: ' +
                'destroyed (`cascade`) or released into the organization ' +
                '(`detach`)',
            },
          },
        },
        false,
      ),
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse(
          'The key holder is not an organization admin (`ROLE_FORBIDDEN`)',
        ),
        '404': errorResponse('Project not found'),
        '409': errorResponse(
          'An automation is installed in the project ' +
            '(`PROJECT_HAS_BOUND_AUTOMATIONS`, `data.automations`), a ' +
            'cascade would destroy a protected controlled record ' +
            '(`PROJECT_HAS_PROTECTED_RECORDS`, `data.documents`), or a legal ' +
            'hold covers a document of the project (`PROJECT_LEGAL_HOLD`)',
        ),
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
        '(`PROJECT_AGENT_SKILL_UNKNOWN`), a connector the organization ' +
        'has not connected (`PROJECT_AGENT_CONNECTOR_UNKNOWN`) or a secret ' +
        'name the organization has not stored ' +
        '(`PROJECT_AGENT_SECRET_UNKNOWN` — `data.secrets` names them); a ' +
        'duplicate name (`PROJECT_AGENT_NAME_TAKEN`); or the 50-agent limit ' +
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
        'Creates an agent in the named project using its existing access ' +
        'rules. Requires project edit access; archived projects are ' +
        'read-only. Agent names are unique within the project ' +
        '(case-insensitive), and a project holds at most 50 agents. ' +
        'Invalid configuration, a duplicate name, an unknown secret name ' +
        '(refused by name — `PROJECT_AGENT_SECRET_UNKNOWN` — never pruned ' +
        'on this door), or exceeding the limit answers 400.',
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
      description:
        'One project agent with its full configuration — the model pair, skills, connectors, tool grants and the names (never the values) of its secrets.',
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
        'Saves the complete configuration of an existing agent in this ' +
        'project. Omitted optional fields reset to their empty values, so ' +
        'send the whole configuration you mean to keep. Pass the ' +
        '`updatedAt` you last read as `expectedUpdatedAt` to make the save ' +
        'conditional: an agent that changed since answers 409 ' +
        '`PROJECT_AGENT_STALE` (`data.updatedAt` is the current stamp) and ' +
        'nothing is written — reload it and merge before saving again. ' +
        'Requires project edit access; changing secret-name grants requires ' +
        'an organization admin, and an unknown secret name is refused by ' +
        'name (`PROJECT_AGENT_SECRET_UNKNOWN`), never pruned. An agent from ' +
        'another project answers 404 even if the key holder can access both ' +
        'projects.',
      operationId: 'updateProjectAgent',
      security: sec,
      parameters: [
        ...projectAgentParameters,
        pathParam('agentId', 'Agent ID within this project'),
      ],
      requestBody: jsonBody(ref('ProjectAgentUpdate')),
      responses: {
        '200': jsonResponse('Saved project agent', projectAgentResponse),
        '409': errorResponse(
          '`expectedUpdatedAt` is older than the agent’s `updatedAt` ' +
            '(`PROJECT_AGENT_STALE`) — nothing was written',
        ),
        ...projectAgentErrors,
      },
    },
    delete: {
      tags: ['Agents'],
      summary: 'Delete a project agent',
      operationId: 'deleteProjectAgent',
      description:
        'Delete the project agent; its past runs and their records stay.',
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
        'GET-OR-CREATE semantics: a folder of the same name under the same ' +
        'parent — compared without regard to case, the way sibling names ' +
        'are unique — answers 200 with `created: false` and the STORED ' +
        'spelling; otherwise the folder is created and answered 201 with ' +
        '`created: true`. Two concurrent creates of one name yield one ' +
        'folder (the sibling rule is database-enforced). `name` is trimmed; ' +
        'a name that is a path (`a/b`, `.`, `..`) is refused ' +
        '(`FOLDER_NAME_INVALID`), and a parent 20 levels deep refuses a ' +
        'child (`FOLDER_DEPTH_EXCEEDED`). `parentId` must name a folder of ' +
        'THIS project (an opaque 404 otherwise); omit it for a root folder. ' +
        'Requires the org editor role and project edit access. Charged ' +
        'against the general REST bucket (120/min) and the per-org ' +
        '`folder:mutate` budget the in-app folder actions share.',
      operationId: 'getOrCreateProjectFolder',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description:
              'Trimmed; matched against siblings without regard to case. ' +
              'No path separators, not `.` or `..`.',
          },
          parentId: {
            type: 'string',
            maxLength: 64,
            description: 'Parent folder id (a folder of this project)',
          },
        },
      }),
      responses: {
        ...standardErrors,
        '200': jsonResponse('The existing folder', ref('ProjectFolderResult')),
        '201': jsonResponse('The created folder', ref('ProjectFolderResult')),
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), a name that is a ' +
            'path (`FOLDER_NAME_INVALID`), or a parent at the depth cap ' +
            '(`FOLDER_DEPTH_EXCEEDED`)',
        ),
        '403': errorResponse('No write access to an active project'),
        '404': errorResponse('Project or parent folder not found'),
        '409': errorResponse(
          'A same-name sibling appeared while the folder was being created ' +
            'and could not be re-read (`FOLDER_NAME_TAKEN`) — retry the ' +
            'call, it answers the existing folder',
        ),
      },
    },
  };

  paths['/api/v1/projects/{id}/folders/{folderId}'] = {
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project folder and everything beneath it',
      description:
        'Permanent, cascading: every file under the folder (subfolders ' +
        'included) is purged — its document row, its search-corpus rows ' +
        '(released at once, so project search stops matching them) and its ' +
        'blob — then the subtree goes. A protected controlled record or a ' +
        'legal hold anywhere beneath refuses the whole delete before ' +
        'anything is removed. Requires the org editor role and project ' +
        'edit access on an active project; charged against the general ' +
        'REST bucket and the per-org `folder:mutate` budget the in-app ' +
        'folder actions share. A folder of another project or ' +
        'organization answers the same opaque 404.',
      operationId: 'deleteProjectFolder',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('folderId', 'Folder ID'),
      ],
      responses: {
        '204': noContent('Deleted, with everything beneath it'),
        '403': errorResponse('No write access to an active project'),
        '404': errorResponse(
          'Project or folder not found (`FOLDER_NOT_FOUND`)',
        ),
        '409': errorResponse(
          'A protected record beneath the folder (`DOCUMENT_RECORD_PROTECTED`) or a legal hold (`LEGAL_HOLD_ACTIVE`)',
        ),
        '503': errorResponse(
          'The purge could not remove every dead surface (`PURGE_INCOMPLETE`): nothing was removed, retry the delete',
        ),
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
        'for both. Send `fileName` to have the bind’s type rules run here ' +
        'too: the organization’s extension and MIME allowlists and the ' +
        'platform’s format allowlist refuse a name they would refuse at ' +
        'the bind — 400 `UPLOAD_POLICY_REJECTED` / `UNSUPPORTED_FILE_TYPE` ' +
        '— before anything is presigned, so the bytes never travel (size ' +
        'and volume caps are still judged at the bind, where the landed ' +
        'size is known). Requires the org editor role and project edit ' +
        'access. Uses the upload lane bucket (240/min — one logical upload ' +
        'is several calls; keyed on the key holder like every REST ' +
        'budget).',
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
                'Optional. Checked against the bind’s own rules — a file ' +
                'name (no path separators, no `..`, no control ' +
                'characters) whose type the upload policy and the format ' +
                'allowlist accept — so a bad name fails here, before the ' +
                'bytes are uploaded; the bind’s `fileName` is what is ' +
                'stored.',
            },
            contentType: { type: 'string', maxLength: 255 },
          },
        },
        false,
      ),
      responses: {
        ...standardErrors,
        '200': jsonResponse('The upload handoff', ref('ProjectUploadHandoff')),
        '400': errorResponse(
          'Malformed body (`INVALID_BODY`), or `fileName` names a type ' +
            'the organization’s upload policy (`UPLOAD_POLICY_REJECTED`) ' +
            'or the platform’s format allowlist (`UNSUPPORTED_FILE_TYPE`) ' +
            'refuses',
        ),
        '403': errorResponse('No write access to an active project'),
        '404': errorResponse('Project not found'),
        '503': errorResponse(
          'No object store is configured for this deployment ' +
            '(`OBJECT_STORE_UNCONFIGURED`) — nothing can be uploaded until ' +
            'an operator connects one',
        ),
      },
    },
  };

  paths['/api/v1/projects/{id}/files/{documentId}'] = {
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project file',
      description:
        'Permanent: the file’s document row, its search-corpus rows and its ' +
        'blob are purged through the same lane every hard delete uses ' +
        '(controlled-record protection, legal holds, the audit row). ' +
        'Requires the org editor role and project edit access on an active ' +
        'project. A file of another project or organization, a document ' +
        'without a file, and a trashed or absent one answer the same ' +
        'opaque 404.',
      operationId: 'deleteProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('No write access to an active project'),
        '404': errorResponse('Project or file not found (`FILE_NOT_FOUND`)'),
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

  paths['/api/v1/projects/{id}/files/{documentId}/content'] = {
    get: {
      tags: ['Projects'],
      summary: 'Download a project file',
      description:
        'The result lane: fetch the bytes of a file in the project — ' +
        'including what an automation filed back (a prepared return, a ' +
        'report). The bytes are streamed in the response itself (**200**, ' +
        'no redirect to follow), with the stored name in an RFC 6266 ' +
        '`Content-Disposition` (`filename` and `filename*`), the stored ' +
        '`Content-Type`, `Content-Length`, `ETag` and `Last-Modified`; ' +
        '`Range` is honoured (206, or 416 for a range the file cannot ' +
        'satisfy) and a HEAD request answers the headers alone. Visibility is the ' +
        'minting user’s; a cross-project, cross-organization, trashed, or ' +
        'absent file answers the same opaque 404, and a file whose bytes ' +
        'the store no longer holds does too. A store that does not answer ' +
        'is a 503 with `Retry-After`.',
      operationId: 'downloadProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '200': {
          description:
            'The file bytes, named by `Content-Disposition`; 206 for a ' +
            'satisfied `Range`',
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '404': errorResponse('File not found (`FILE_NOT_FOUND`)'),
        '503': errorResponse(
          'The object store did not serve the file ' +
            '(`OBJECT_STORE_UNAVAILABLE`, with `Retry-After`) or none is ' +
            'configured (`OBJECT_STORE_UNCONFIGURED`)',
        ),
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
        '404': errorResponse(
          'Project or folder not found (`PROJECT_NOT_FOUND`, ' +
            '`FOLDER_NOT_FOUND`), or the bytes never landed at the ' +
            'presigned URL (`BLOB_NOT_FOUND` — the intent is rolled back, ' +
            'PUT the file and bind again)',
        ),
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
        '503': errorResponse(
          'No object store is configured for this deployment ' +
            '(`OBJECT_STORE_UNCONFIGURED`)',
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
    'The project is missing or invisible (`PROJECT_NOT_FOUND` — the URL is ' +
      'judged left to right, so a bad project id is blamed on the project), ' +
      'or the task is missing or outside this project (`TASK_NOT_FOUND`)',
  );
  paths['/api/v1/projects/{id}/tasks'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Create a project task from an external ref (idempotent)',
      description:
        'Uses the project in the URL and requires project write access. The first ' +
        '`(project, externalSystem, externalId)` intake creates a task (201); a repeat ' +
        'returns the same task (200) — both keys are compared after NFC normalization ' +
        'and trimming, the form they are stored in, so a padded or differently ' +
        'normalized repeat is still the same task. An active task takes the new title and description ' +
        '(omitting description clears it); labels change only when supplied. An archived ' +
        'task stays unchanged. An archived project refuses intake. The key holder creates ' +
        'the task. `automationSlug` must ' +
        'name a deployed automation applicable to this project and fills an empty assignee ' +
        'without replacing an existing one. `runWorkflowSlug` starts only a freshly created ' +
        'task; poll its `runId` at `GET /api/v1/projects/{id}/runs/{runId}` (`executionId` ' +
        'carries the same value and is deprecated). An undeployed ' +
        'workflow or a start failure after the task committed returns `runId` null. ' +
        'An idempotent repeat omits `runId` and does not re-validate `runWorkflowSlug` ' +
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
          externalSystem: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description:
              'The source system’s name; stored and compared after NFC ' +
              'normalization and trimming, never blank',
          },
          externalId: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
              'Caller-owned idempotency key within this project and external ' +
              'system; stored and compared after NFC normalization and ' +
              'trimming (whitespace alone is refused)',
          },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: TASK_TITLE_MAX,
            description:
              'Trimmed; the board’s title cap — a longer title is refused ' +
              'with 400 `INVALID_BODY`, never clipped',
          },
          description: { type: 'string', maxLength: 20000 },
          labels: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 1,
              maxLength: TASK_LABEL_CHARS_MAX,
            },
            maxItems: 50,
            description:
              'Names resolved against the project label catalog (created ' +
              'when missing); trimmed, never blank',
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
        'The task must belong to the URL project and be visible to the key holder. Archived tasks remain readable. Keep the `runId` from a start to poll `GET /api/v1/projects/{id}/runs/{runId}`; the task response has no live-run linkage.',
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
                  createdAt: epochMs,
                  editedAt: epochMs,
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
        'Any member who can read the project may comment; an editor seat is not required. The task must belong to the URL project, and both the project and the task must be active — an archived task refuses the comment (403 `TASK_ARCHIVED`) the way an archived project does (`PROJECT_ARCHIVED`). `body` is trimmed; whitespace alone is a missing body. Comments use the key holder as author and share the app’s per-user task:comment budget and mention behavior.',
      operationId: 'addTaskComment',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          body: {
            type: 'string',
            minLength: 1,
            maxLength: 10000,
            description: 'Trimmed; whitespace alone is refused',
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
              properties: { id: str },
            },
          },
        }),
        '403': errorResponse(
          'The project (`PROJECT_ARCHIVED`) or the task (`TASK_ARCHIVED`) ' +
            'is archived',
        ),
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
        'Requires write access to an active project and an active task belonging to it (an archived task answers 403 `TASK_ARCHIVED`). Runs the deployed workflow with this task as its input, attributed to the URL project and api-key:<userId>. An organization automation can operate in the project; a project-bound automation must include this project. A concurrent start reuses the live run. The answer is 200 either way — branch on `started`, never on the status alone: an undeployed workflow answers `started: false` with `reason: "not_started"` and a null `runId`; other refusals return their error status. Poll `runId` at `GET /api/v1/projects/{id}/runs/{runId}` (`executionId` carries the same value and is deprecated). Charges the execute bucket on top of the general REST bucket.',
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
          required: ['started', 'runId', 'executionId'],
          properties: {
            started: bool,
            reason: {
              type: 'string',
              enum: ['already_running', 'not_started'],
              description: 'Present when started is false',
            },
            runId: {
              type: 'string',
              nullable: true,
              description:
                'New or existing run ID for GET /api/v1/projects/{id}/runs/{runId}; null when not_started',
            },
            executionId: {
              type: 'string',
              nullable: true,
              deprecated: true,
              description:
                'Alias of `runId` — the name this family shipped with; ' +
                'read `runId`',
            },
          },
        }),
        '403': errorResponse(
          'Project is read-only or archived, the task is archived ' +
            '(`TASK_ARCHIVED`), or the automation is bound elsewhere',
        ),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
  };

  // ── Automations ───────────────────────────────────────────────────────────

  /** What every run listing says about its shape. */
  const RUN_LISTING_DESCRIPTION =
    'Newest first, as summaries (`RunSummary`: identity, scope, status and ' +
    'timing — never the input, output, trace or checkpoints unless ' +
    '`include` names them), paged by a signed keyset cursor: pass ' +
    '`continueCursor` back as `cursor` until `isDone`. `status` narrows the ' +
    'listing to one or more statuses.';
  /** The query every run listing takes. */
  const runListingParams = [
    ...paginationParams(200, 50),
    queryParam(
      'status',
      'Only runs in these statuses — one or more of `queued`, `running`, ' +
        '`waiting`, `success`, `failed`, `cancelled`, comma-separated; any ' +
        'other value answers 400 `INVALID_QUERY`',
    ),
    queryParam(
      'include',
      'Full-row fields to inline on each summary — one or more of `input`, ' +
        '`output`, `trace`, `effects`, `checkpoints`, comma-separated; any ' +
        'other value answers 400 `INVALID_QUERY`',
    ),
  ];
  /** The `{runs, isDone, continueCursor}` page every run listing answers. */
  const runsPage: Json = {
    type: 'object',
    required: ['runs', 'isDone', 'continueCursor'],
    properties: {
      runs: { type: 'array', items: ref('RunSummary') },
      isDone: { type: 'boolean' },
      continueCursor: {
        type: 'string',
        description:
          'Pass back as `cursor` for the next page; empty when `isDone`',
      },
    },
  };
  /** The header that makes a run start safe to retry. */
  const runIdempotencyKeyParam = {
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: false,
    schema: { type: 'string' },
    description:
      'A stable key of your choosing that names this start. A repeat with ' +
      'the same key, automation and scope within 24 hours answers 202 with ' +
      'the run the first attempt started and `duplicate: true`; a repeat ' +
      'with a different body answers 409 `IDEMPOTENCY_KEY_REUSED`. A ' +
      'refused start is not remembered, so the same key runs once the ' +
      'refusal is fixed. A blank value is read as no key.',
  };

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
      description:
        'The latest SAVED version by default — a draft, possibly. A live run ' +
        'executes the deployed version: read it with `?version=deployed` to ' +
        'learn the `inputs` schema of the code that will actually run.',
      parameters: [
        automationNameParam,
        queryParam(
          'version',
          '`latest` (the default: the newest saved version), `deployed` ' +
            '(the version live runs execute), or a version number',
        ),
      ],
      responses: {
        '200': jsonResponse('The automation version', ref('Automation')),
        '404': errorResponse(
          'Automation not found (`AUTOMATION_NOT_FOUND`); or the automation ' +
            'exists but has no such version — a number never saved, or ' +
            '`deployed` while nothing is deployed (`AUTOMATION_VERSION_UNKNOWN`)',
        ),
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
      description:
        'The immutable version history, complete — not paginated. ' +
        '`deployedVersion` names the live one and each row says whether it ' +
        'is `deployed`.',
      operationId: 'listAutomationVersions',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'Immutable version history',
          listOf('versions', ref('AutomationVersion'), {
            name: str,
            deployedVersion: nullable({
              ...int,
              description: 'null while nothing is deployed',
            }),
          }),
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
        description: `${RUN_LISTING_DESCRIPTION} ${scope.project ? 'Includes only runs attributed to the URL project; requires project read access.' : 'Includes only runs without a project. Project runs are read through their project URL.'} Poll a run at GET ${runPath}.`,
        operationId: scope.project
          ? 'listProjectAutomationRuns'
          : 'listAutomationRuns',
        security: sec,
        parameters: [...parameters, ...runListingParams],
        responses: {
          '200': jsonResponse('Newest runs first', runsPage),
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
        description: `Answers 202 with the run identity; poll GET ${runPath}. Mode defaults to live and requires the developer capability. ${scope.project ? 'Both live and mock starts require write access to the active URL project. An automation with bindings must include this project; an unbound definition may also run here.' : 'Mock mode requires membership. Only definitions without project bindings can start here; a project-bound definition returns 409 AUTOMATION_PROJECT_SCOPE_REQUIRED.'} The body accepts input, mode and version only. Send \`Idempotency-Key\` to make the start safe to retry: a repeat within 24 hours answers the run the first attempt started with \`duplicate: true\`, and a repeat with a different body answers 409 \`IDEMPOTENCY_KEY_REUSED\`; a refused start remembers nothing. Charges the execute bucket on top of the general REST bucket.`,
        operationId: scope.project
          ? 'startProjectAutomationRun'
          : 'startAutomationRun',
        security: sec,
        parameters: [...parameters, runIdempotencyKeyParam],
        requestBody: jsonBody(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              input: {
                description:
                  'Run input; must match the automation inputs schema when declared. Absent means an empty object; `null` is sent as null, for the schema to judge.',
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
          '202': jsonResponse(
            'Run started, or the run an earlier attempt under the same `Idempotency-Key` started',
            {
              type: 'object',
              required: ['runId', 'version', 'name', 'mode'],
              properties: {
                runId: str,
                version: int,
                name: str,
                mode: { type: 'string', enum: ['live', 'mock'] },
                duplicate: {
                  type: 'boolean',
                  enum: [true],
                  description:
                    'Present when the `Idempotency-Key` had already started this run: nothing new ran',
                },
              },
            },
          ),
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
            (scope.project
              ? 'No deployed version (`AUTOMATION_NOT_DEPLOYED`), the requested live version is not deployed (`AUTOMATION_VERSION_NOT_DEPLOYED`)'
              : 'Project scope is required (`AUTOMATION_PROJECT_SCOPE_REQUIRED` — `data.projectIds` names the visible projects the automation is installed in; start it at `/api/v1/projects/{id}/automations/{name}/runs`), no version is deployed (`AUTOMATION_NOT_DEPLOYED`), the requested live version is not deployed (`AUTOMATION_VERSION_NOT_DEPLOYED`)') +
              ', or the `Idempotency-Key` was already used for a different request (`IDEMPOTENCY_KEY_REUSED`)',
          ),
          ...standardErrors,
          '400': errorResponse(
            'Invalid body or parameters (`INVALID_BODY`), or input that does not match the automation inputs schema (`AUTOMATION_INPUT_INVALID` — `data.issues` names each problem)',
          ),
        },
      },
    };
  }

  // ── Runs across automations ───────────────────────────────────────────────

  paths['/api/v1/runs'] = {
    get: {
      tags: ['Runs'],
      summary: 'List every run the key holder can see',
      description: `${RUN_LISTING_DESCRIPTION} Whatever started them and whatever automation ran: organization runs and the runs of every project the key holder can see, each row naming its \`projectId\` — a project run is read in full at \`/api/v1/projects/{projectId}/runs/{runId}\`, an organization run at \`/api/v1/runs/{runId}\`.`,
      operationId: 'listRuns',
      security: sec,
      parameters: [orgSlugHeaderParam, ...runListingParams],
      responses: {
        '200': jsonResponse('Newest runs first', runsPage),
        ...standardErrors,
      },
    },
  };
  paths['/api/v1/projects/{id}/runs'] = {
    get: {
      tags: ['Runs'],
      summary: 'List a project’s runs',
      description: `${RUN_LISTING_DESCRIPTION} Every run attributed to the URL project, whatever automation ran; requires project read access.`,
      operationId: 'listProjectRuns',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        ...runListingParams,
      ],
      responses: {
        '200': jsonResponse('Newest runs first', runsPage),
        '404': errorResponse(
          'Project missing or invisible (`PROJECT_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
  };

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
            enum: [...EMITTED_EVENT_TYPES],
            description:
              'Event trigger: the platform event that starts the automation — ' +
              'one of the events the platform raises. Any other name answers ' +
              '400 `AUTOMATION_TRIGGER_INVALID`, naming this list.',
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
        '400': errorResponse(
          'Invalid body (`INVALID_BODY`), or a trigger that could never fire: a cron that matches nothing, a time zone that is not an IANA zone, an event the platform does not raise (`AUTOMATION_TRIGGER_INVALID`)',
        ),
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
      delete: {
        tags: ['Runs'],
        summary: 'Delete a finished run',
        description: `${visibility} Requires the developer capability.${scope.project ? ' The project must be active and writable.' : ''} Removes the run — its stored input and output included — together with the questions it asked and the webhook-delivery and idempotency entries that would otherwise answer a repeat with a run that no longer exists. A run still in flight is refused: cancel it first.`,
        operationId: scope.project ? 'deleteProjectRun' : 'deleteRun',
        security: sec,
        parameters,
        responses: {
          '204': noContent('Deleted'),
          '403': errorResponse(
            scope.project
              ? 'Requires developer capability and write access to an active project'
              : 'Requires developer capability',
          ),
          '404': errorResponse(
            'Run missing or outside the visible URL scope (`RUN_NOT_FOUND`)',
          ),
          '409': errorResponse(
            'The run is still queued, running or waiting (`RUN_ACTIVE`)',
          ),
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
        description: `A direct chat with the built-in assistant. ${scope.project ? 'The URL supplies its project context. Any member with project read access may create a chat while the project is active.' : 'The thread has no project context.'} This operation accepts only an optional title; agent selectors and projectId are refused. Project agents execute through project tasks. A thread created without a title is named by the assistant after its first message (read \`title\` back from the thread); \`PATCH\` renames it.`,
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
        summary: 'Archive, restore or rename a thread',
        description: `${visibility} Archiving is the app’s own toggle, audited the same way: an archived thread stays readable and refuses messages with 409 \`CHAT_THREAD_ARCHIVED\`; \`archived: false\` restores it. Archiving stamps \`archivedAt\` and leaves \`updatedAt\` — the last message activity — untouched. \`title\` renames the thread (trimmed, 1–120 characters). Send at least one of the two.`,
        operationId: scope.project ? 'updateProjectThread' : 'updateThread',
        security: sec,
        parameters: itemParameters,
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            archived: bool,
            title: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
              description: 'The new name, trimmed',
            },
          },
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
        description: `${visibility} ${scope.project ? 'The project must be active; members can send without an editor seat. ' : ''}Answers 202 while the turn runs in the background; the 202 names the assistant message the reply lands in (\`messageId\`). Poll GET ${scope.item}/generation until status is idle, then read the messages. Every turn runs the built-in workspace assistant: its instructions, safety rules and three retrieval tools ride every request (about 3,000 prompt tokens, counted in \`usage.inputTokens\`), and a request for a deliverable is redirected to Tasks by design — this is a conversation with the workspace, not a bare model call. A turn failure appears as an assistant error message. Charges the execute bucket on top of the general REST bucket.`,
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
            reasoningEffort: {
              type: 'string',
              enum: [...EFFORT_LEVELS],
              description:
                'The reasoning depth, on the same five-step scale the app offers; omitted samples the model’s default. Ignored by a model whose `capabilities.reasoning` is false.',
            },
            maxOutputTokens: {
              type: 'integer',
              minimum: 1,
              description:
                'The largest reply this turn may produce, in tokens — a cap under the model’s own `maxOutputTokens` from GET /api/v1/models; a value above it answers 400 `INVALID_BODY`. Omitted, the model’s own ceiling applies. A thinking model keeps its reasoning budget under the cap.',
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
            required: [
              'threadId',
              'status',
              'model',
              'providerSlug',
              'messageId',
              'poll',
            ],
            properties: {
              threadId: str,
              status: { type: 'string', enum: ['accepted'] },
              model: str,
              providerSlug: {
                ...str,
                description:
                  'The provider the turn runs on — named in the request, or resolved from the model list',
              },
              messageId: {
                ...str,
                description:
                  'The assistant message the reply lands in — the row GET …/messages carries as `pending` until the turn settles. Keep it: a caller that loses this response finds its reply by this id.',
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
        description: `${visibility} \`queued\`: the accepted send is waiting for a worker (the 202 was answered, the turn has not opened). \`streaming\`: the model is streaming its reply to the server — \`text\` and \`reasoning\` carry what has arrived so far, so a poller sees progress; there is no push channel on this surface. \`idle\`: no turn is running — the reply, if any, is in the messages. After a lost 202, poll here: \`queued\` or \`streaming\` means keep polling, \`idle\` means read the messages and find the reply by the \`messageId\` the 202 named (or the newest \`user\` row carrying your \`content\`).`,
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
                  description:
                    'The assistant message the turn streams into (present while queued or streaming)',
                },
                text: {
                  type: 'string',
                  description:
                    'The reply text streamed so far (present while streaming)',
                },
                reasoning: {
                  type: 'string',
                  description:
                    'The model’s reasoning streamed so far — display-only, may be empty (present while streaming)',
                },
                cancelRequested: {
                  type: 'boolean',
                  description:
                    'A stop was asked for and the turn has not settled yet (present while streaming)',
                },
                updatedAt: {
                  ...epochMs,
                  description:
                    'Epoch ms of the last progress write (present while streaming)',
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

  /** The slug as the file layer holds it: the directory name of the
   * bundle, so its charset and length are the file layer's, and the two
   * upstream names are reserved. */
  const skillSlugParam = {
    ...pathParam(
      'slug',
      `The skill slug — at most ${MAX_SKILL_SLUG_LENGTH} characters of lowercase letters, digits and single hyphens; \`anthropic\` and \`claude\` are reserved. Reads and the delete answer a malformed slug as absent (404 \`SKILL_NOT_FOUND\`); the save refuses it with 400 \`INVALID_SKILL_SLUG\`, naming the rule it breaks.`,
    ),
    schema: {
      type: 'string',
      pattern: SKILL_SLUG_REGEX.source,
      maxLength: MAX_SKILL_SLUG_LENGTH,
    },
  };

  paths['/api/v1/skills/{slug}'] = {
    get: {
      tags: ['Skills'],
      summary: 'Get skill',
      operationId: 'getSkill',
      description:
        'One skill bundle: the summary fields plus the body and the file list. A malformed slug answers 404 like an unknown one.',
      security: sec,
      parameters: [skillSlugParam],
      responses: {
        '200': jsonResponse('The skill', ref('Skill')),
        '404': errorResponse(
          'No such skill, none this key may see, or a malformed slug (`SKILL_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Skills'],
      summary: 'Create or update skill',
      description:
        'Creates the bundle when the slug is free and updates it in place ' +
        'otherwise: `description` and `body` are required, an omitted ' +
        '`icon`, `labels`, `teams` or `visibility` keeps its stored value, ' +
        'and `null` clears `icon` or `labels`. A body that does not end ' +
        'with a newline gets one appended. Send `If-None-Match: *` to ' +
        'create only — a slug that already has a bundle then answers 412 ' +
        '`SKILL_EXISTS` and nothing is written. Every skill carries ' +
        '`canEdit`: whether this key may edit the bundle; shipped skills are ' +
        'organization bundles an administrator may overwrite, so check it ' +
        'before a save that means to replace one.',
      operationId: 'saveSkill',
      security: sec,
      parameters: [
        skillSlugParam,
        {
          name: 'If-None-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string', enum: ['*'] },
          description:
            'Send `*` to create only: a slug that already has a bundle answers 412 `SKILL_EXISTS` and nothing is written. Entity tags are not issued, so any other value matches nothing and the write goes ahead.',
        },
      ],
      requestBody: jsonBody({
        type: 'object',
        required: ['description', 'body'],
        additionalProperties: false,
        properties: {
          description: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_SKILL_DESCRIPTION_LENGTH,
          },
          body: {
            type: 'string',
            maxLength: MAX_SKILL_BODY_BYTES,
            description: `Markdown, at most ${MAX_SKILL_BODY_BYTES} bytes of UTF-8 (bytes, not characters — the maxLength here is the byte budget): the composed SKILL.md, frontmatter included, is capped at 512 KiB, and this budget always fits inside it`,
          },
          visibility: {
            type: 'string',
            enum: [...SKILL_EDIT_VISIBILITIES],
            description:
              'Who sees the skill; omitted keeps the stored value (a new skill is `org`). `private` is retired: it cannot be set, only kept by omission on a bundle that already carries it',
          },
          teams: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_SKILL_TEAM_ID_LENGTH,
            },
            maxItems: MAX_SKILL_TEAMS,
            description:
              'Team ids a `team` skill is shared with; each must be a team of this organization (400 `SKILL_TEAM_UNKNOWN` otherwise)',
          },
          icon: {
            type: 'string',
            maxLength: MAX_SKILL_ICON_LENGTH,
            nullable: true,
            description:
              'An Iconify id (`lucide:book-open`); `null` clears it, omitted keeps it',
          },
          labels: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_SKILL_LABEL_LENGTH,
            },
            maxItems: MAX_SKILL_LABELS,
            nullable: true,
            description: '`null` clears them, omitted keeps them',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The saved skill', ref('Skill')),
        '403': errorResponse('Not editable with this key (`SKILL_FORBIDDEN`)'),
        '412': errorResponse(
          '`If-None-Match: *` was sent and the slug already has a bundle (`SKILL_EXISTS`); nothing was written',
        ),
        '422': errorResponse('The skill body is malformed (`SKILL_MALFORMED`)'),
        ...standardErrors,
        '400': errorResponse(
          'Invalid body (`INVALID_BODY` — an unknown key, a body over the byte budget, a visibility outside `team`/`org`), a malformed slug (`INVALID_SKILL_SLUG`, naming the rule it breaks), an invalid skill (`INVALID_SKILL`), or a team id the organization does not have (`SKILL_TEAM_UNKNOWN`)',
        ),
      },
    },
    delete: {
      tags: ['Skills'],
      summary: 'Delete skill',
      operationId: 'deleteSkill',
      description:
        'Delete the bundle the slug names — its owner, or an administrator; a malformed or unknown slug answers 404 `SKILL_NOT_FOUND`.',
      security: sec,
      parameters: [skillSlugParam],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('Not deletable with this key (`SKILL_FORBIDDEN`)'),
        '404': errorResponse(
          'No such skill, or a malformed slug (`SKILL_NOT_FOUND`)',
        ),
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
        'the in-app editor shares. Mints a file-backed Hub document ' +
        '(`sourceProvider: knowledge`, answered as `documentId`) and queues ' +
        'it for indexing, so the content is searchable once its `indexing` ' +
        'completes — the one way to put text into the search corpus from ' +
        'REST. A supersede re-indexes under the same `documentId`; a delete ' +
        'trashes it. The document itself refuses a direct delete or content ' +
        'edit (`DOCUMENT_HAS_KNOWLEDGE_ENTRY`).',
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
      description:
        'One knowledge entry — active or superseded — with its topic, content, version and the Hub document behind it.',
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
            query: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              description:
                'Trimmed before the length check — a whitespace-only query is 400 `INVALID_BODY`',
            },
            corpus: {
              type: 'string',
              enum: scope.project ? ['documents'] : ['documents', 'web', 'all'],
              default: scope.project ? 'documents' : 'all',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              description:
                'The page size (default 10). The search fuses a wider candidate pool, checks every candidate against its live document and only then cuts the page — `limit: 1` returns the best readable passage',
            },
            minSimilarity: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                'Cosine floor for the dense (vector) leg only. No default: without it the nearest passages answer however weak; the keyword leg is never floored. The built-in assistant’s search tool uses 0.45',
            },
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
    description: 'The request id — a string or an integer',
  };
  const jsonRpcMessage: Json = {
    type: 'object',
    required: ['jsonrpc', 'method'],
    properties: {
      jsonrpc: { type: 'string', enum: ['2.0'] },
      id: {
        ...jsonRpcId,
        description:
          'The request id — a string or an integer (a fraction is refused, -32600); omit it for a notification, which is acknowledged with 202 and never answered',
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
          'The body could not be acted on: not JSON (-32700), not a JSON-RPC 2.0 message, an id that is not a string or an integer, an empty batch, or an unsupported `MCP-Protocol-Version` header (-32600)',
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
          'for 24 hours — matched by value, whichever recognised header carried ' +
          'them — or byte-identical bodies for two minutes when no ID is ' +
          'supplied. Deduplication includes the URL project. Nothing ' +
          'authenticates the sender, so the door is budgeted per sender IP ' +
          'before the token is checked (120 a minute, burst 240) and per ' +
          'trigger once it is verified (20 a minute, burst 40).',
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
            'A forbidden `projectId` query parameter (`INVALID_QUERY`), or ' +
              'input that does not match the automation inputs schema ' +
              '(`AUTOMATION_INPUT_INVALID` — `data.issues` names each problem)',
          ),
          '403': errorResponse(
            'The automation cannot run in the URL project — it does not ' +
              'exist, is archived, or the automation is not installed there; ' +
              'the response never says which (`AUTOMATION_PROJECT_FORBIDDEN`)',
          ),
          '409': errorResponse(
            'The automation has no deployed version (`AUTOMATION_NOT_DEPLOYED`), ' +
              'it is installed in projects and needs the project webhook URL ' +
              '(`AUTOMATION_PROJECT_SCOPE_REQUIRED`), or this delivery was ' +
              'first recorded in another scope (`AUTOMATION_DELIVERY_SCOPE_MISMATCH`)',
          ),
          '413': errorResponse('Body exceeds 256 KiB (`BODY_TOO_LARGE`)'),
          '429': errorResponse(
            'The sender’s or the trigger’s budget is spent; `Retry-After` ' +
              'names the wait (`RATE_LIMITED`)',
          ),
        },
      },
    };
  }

  // The door's own contract is a property of every `/api/v1` operation,
  // not of a family, so it is stamped on each here rather than repeated by
  // hand: the tenant header (a multi-organization key MUST send it on
  // every call; a single-organization key may omit it), the two refusals
  // that header can draw (403 `ORG_FORBIDDEN`, 404 `ORG_SLUG_INVALID`),
  // the 405 a served path answers for a method it does not take, the 500
  // every operation can end in, and the 413 every operation with a body
  // answers past its byte cap. A family's own sentence for a status keeps
  // the lead; the door's clause is appended to it.
  for (const [path, operations] of Object.entries(paths)) {
    if (!path.startsWith('/api/v1/')) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = operation as {
        parameters?: Json[];
        requestBody?: unknown;
        responses: Record<string, Json>;
      };
      const parameters = op.parameters ?? [];
      const declared = parameters.some(
        (parameter) =>
          parameter.in === 'header' &&
          parameter.name === orgSlugHeaderParam.name,
      );
      if (!declared) op.parameters = [orgSlugHeaderParam, ...parameters];
      const responses = op.responses;
      responses['403'] = withDoorRefusal(
        responses['403'],
        '`X-Organization-Slug` names an organization the key holder is no member of (`ORG_FORBIDDEN`)',
      );
      responses['404'] = withDoorRefusal(
        responses['404'],
        '`X-Organization-Slug` names no organization (`ORG_SLUG_INVALID`)',
      );
      responses['405'] ??= errorResponse(
        'The path exists, but not for this method (`METHOD_NOT_ALLOWED`); `Allow` names the methods it serves',
      );
      if (op.requestBody !== undefined) {
        responses['413'] ??= errorResponse(
          'The body exceeds this operation’s byte cap — 1 MiB unless the description says otherwise (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        );
      }
      responses['500'] ??= errorResponse(
        'Internal error (`INTERNAL_ERROR`); the envelope carries a `requestId` to quote when reporting it',
      );
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
Settings → API; a key starts with \`tale\` and carries no separator — treat
the whole string as opaque):

\`\`\`
Authorization: Bearer <api-key>
\`\`\`

Inbound automation webhooks authenticate with their URL token.

If you belong to several organizations, send \`X-Organization-Slug\` on
every request, reads included — without it the request answers 400
\`ORG_SLUG_REQUIRED\`; a slug that names no organization answers 404
\`ORG_SLUG_INVALID\`, one you are no member of 403 \`ORG_FORBIDDEN\`. The
400 lists the slugs you may send under \`data.organizations\`, and so does
\`GET /api/v1/me\` on any call that names one.

## Requests

Bodies are JSON, read strictly: UTF-8 only, no NUL character, and a whole
number beyond 2^53 − 1 is refused rather than rounded (send such an id as a
string). Every body schema is strict — an unknown key answers 400
\`INVALID_BODY\` naming it — and so is every query string: a parameter a
route does not take, one given twice, or a named filter left blank answers
400 \`INVALID_QUERY\`, and writes take no query parameters at all. A body is
capped at 1 MiB unless the operation says otherwise (a document's inline
content 32 MiB, the contacts bulk import 8 MiB, a conversation snapshot 8
MiB, a staged conversation upload 30 MiB, a skill save 4 MiB); past the cap
the answer is 413 \`BODY_TOO_LARGE\`, before a byte is read when the length
is declared. Bodies are read as JSON whatever Content-Type says; there is no
415. Every served path answers HEAD (for a GET) and OPTIONS (204 with
\`Allow\`); a method a path does not take answers 405 \`METHOD_NOT_ALLOWED\`
with \`Allow\`. A request URL above 32 KiB is refused at the edge with 431.
Every response carries an \`X-Request-Id\` — send your own to correlate.

## Errors

Non-2xx responses carry a flat envelope: \`{"error": "<sentence>", "code":
"<CODE>"}\`. Every refusal carries a stable \`code\` — the \`Error.code\` enum
below, additive, so treat a value you do not know as a generic refusal of
the status you got. A 429 repeats the code in \`error\`; a 500 and a
body-size 413 add \`requestId\`; a refused body or query lists every problem
under \`data.issues\`.

## Pagination

The keyset-paginated lists — contacts, products, documents, knowledge
entries, threads, messages, websites — take \`cursor\` + \`limit\` and answer
\`{page, isDone, continueCursor}\`; pass \`continueCursor\` back as \`cursor\`
until \`isDone\`. Lists that answer a named array (\`{automations}\`,
\`{agents}\`, \`{skills}\`, \`{folders}\`, \`{models}\`, \`{sessions}\`,
\`{deliveries}\`, \`{versions}\`, \`{triggers}\`) are complete sets or bounded
windows; runs and task comments answer their named array WITH \`isDone\` and
\`continueCursor\` (\`{runs, …}\`, \`{comments, …}\`); search answers \`{hits,
diagnostics}\`, website pages \`{pages, total, offset, hasMore}\`; project
files answer \`{files, isDone, cursor?}\` and the project list \`{projects,
isDone, cursor?}\` — pass \`cursor\` back unchanged until \`isDone\`. Every
cursor is an opaque signed token: one this list never answered is refused
with 400 \`INVALID_CURSOR\`, never read as the first page.

## Rate limits

Budgets are keyed on the key holder — the user the key acts as — never on a
network address: reads and CRUD share one bucket (120/min, burst 200);
starting an automation run, sending a chat message and starting a task
workflow share a tighter one (20/min, burst 40); the project upload flow has
its own (240/min, burst 300). A key that fails to authenticate is throttled
per source IP instead (20/min, burst 40), so strangers never draw from a key
holder's budget; the inbound webhook door, which carries no key, is budgeted
per sender address (120/min, burst 240) and per trigger (20/min, burst 40).
A 429 carries \`Retry-After\` in whole seconds.

## Quick start

\`\`\`bash
# 1. List automations installed in an existing project
curl -H "Authorization: Bearer <api-key>" \\
  -H "X-Organization-Slug: <orgSlug>" \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations"

# 2. Start a deployed automation in that project
curl -X POST -H "Authorization: Bearer <api-key>" \\
  -H "X-Organization-Slug: <orgSlug>" \\
  -H "Content-Type: application/json" -d '{"input": {}}' \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations/billing__dunning/runs"

# 3. Poll it
curl -H "Authorization: Bearer <api-key>" \\
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
      {
        name: 'Conversations',
        description:
          'Mirroring external conversations into Inbox — versioned snapshots, reply claims, delivery receipts and staged uploads.',
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
            requestId: {
              type: 'string',
              description:
                'The response’s `X-Request-Id`, repeated on a 500 and on a body-size 413 so a caller can quote it',
            },
            data: {
              type: 'object',
              properties: {
                retryAfterMs: {
                  type: 'number',
                  description: 'Wait in milliseconds for RATE_LIMITED',
                },
                organizations: {
                  type: 'array',
                  description:
                    'For ORG_SLUG_REQUIRED, the organizations the key holder belongs to — send one of the slugs as `X-Organization-Slug`',
                  items: {
                    type: 'object',
                    required: ['slug', 'name'],
                    properties: {
                      slug: { type: 'string' },
                      name: { type: 'string' },
                    },
                  },
                },
                issues: {
                  type: 'array',
                  description:
                    'For INVALID_BODY and INVALID_QUERY, every problem the schema found in the body or the query string; for AUTOMATION_INPUT_INVALID, every problem the automation’s inputs schema found in the run input (at most 20 either way), each naming the field and the reason; `error` repeats the first one',
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
            createdAt: epochMs,
            updatedAt: epochMs,
            indexing: {
              type: 'object',
              required: ['status'],
              additionalProperties: false,
              description:
                'Where a file-backed document stands in the search corpus — absent for a content-only document (never indexed) and for a blob the platform does not track. Poll it after a create or a `retry-indexing`.',
              properties: {
                status: {
                  type: 'string',
                  enum: [
                    'pending',
                    'queued',
                    'running',
                    'completed',
                    'failed',
                    'unsupported',
                    'skipped',
                  ],
                  description:
                    '`pending` — never queued; `skipped` — the file opts out of indexing; `unsupported` — no text extractor for this type; `failed` — see `error` / `errorCode`',
                },
                indexedAt: {
                  ...epochMs,
                  description: 'Epoch ms of the last completed indexing',
                },
                error: str,
                errorCode: str,
              },
            },
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
            expectedUpdatedAt: {
              type: 'integer',
              minimum: 0,
              description:
                'The `updatedAt` last read; the update applies only while the document still carries it, else 409 `DOCUMENT_STALE`',
            },
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
            lastScannedAt: nullable(epochMs),
            status: nullable(str),
            pageCount: nullable(int),
            crawledPageCount: nullable(int),
            metadata: nullable(obj),
            createdAt: epochMs,
            updatedAt: epochMs,
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
            'is keyed by it): a body carrying a `domain` other than the ' +
            'stored one is refused with 400 `WEBSITE_DOMAIN_IMMUTABLE` — ' +
            'delete the website and re-add it under the new domain. The ' +
            'stored value itself may be echoed, as a client that sends the ' +
            'resource it read does.',
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
            lastCrawledAt: nullable(epochMs),
            discoveredAt: nullable(epochMs),
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
            expiresAt: epochMs,
            lastUsedAt: nullable({
              ...epochMs,
              description: 'Epoch ms of the last claim',
            }),
            failureCount: int,
          },
        },
        BrowserSessionImport: {
          type: 'object',
          required: ['domain', 'cookiesJar'],
          additionalProperties: false,
          properties: {
            domain: {
              ...str,
              minLength: 1,
              maxLength: 255,
              description:
                'The host the jar was warmed for — a hostname or an http(s) URL, normalized to its lower-cased hostname on import; private-network and metadata hosts are refused (400 `INVALID_SESSION`)',
            },
            cookiesJar: {
              ...str,
              minLength: 1,
              maxLength: 1_000_000,
              description: 'A Netscape-format cookie jar, at most 1 MB',
            },
            userAgent: { ...str, maxLength: 512 },
            visitorData: { ...str, maxLength: 2048 },
            poToken: { ...str, maxLength: 4096 },
            label: { ...str, maxLength: 120 },
            ttlMs: {
              ...int,
              minimum: 1,
              maximum: MAX_SESSION_TTL_MS,
              description: `Lifetime in milliseconds (default ${DEFAULT_SESSION_TTL_MS}, 14 days; at most ${MAX_SESSION_TTL_MS}, 180 days)`,
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
            createdAt: epochMs,
            updatedAt: epochMs,
          },
        },
        ProductInput: {
          type: 'object',
          description:
            '`name` is required on create; every field is optional on update. ' +
            'Strings are trimmed, and a blank optional field reads as left ' +
            'out. Unknown keys are refused (`INVALID_BODY`).',
          additionalProperties: false,
          properties: productInputProperties,
        },
        ProductPatch: {
          type: 'object',
          description:
            'Every field optional. `null` clears any optional field, and a ' +
            'blank string reads as `null` (a blank `name` is refused); ' +
            '`metadata` merges per RFC 7396. Send `expectedUpdatedAt` from ' +
            'the last product read to update only that revision: a stale ' +
            'one answers 409 `PRODUCT_STALE` without changing any field, ' +
            'and every successful update advances `updatedAt`.',
          additionalProperties: false,
          properties: {
            ...nullableProperties(productInputProperties, ['name']),
            expectedUpdatedAt: expectedUpdatedAtProperty,
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
            createdAt: epochMs,
            updatedAt: epochMs,
          },
        },
        ContactInput: {
          type: 'object',
          description:
            'Unknown keys are refused (`INVALID_BODY`). Strings are trimmed, ' +
            'and a blank optional field reads as left out (a CSV-shaped row ' +
            'imports cleanly). A create needs at least one of `name`, ' +
            '`email` or `externalId` to file the contact under.',
          additionalProperties: false,
          properties: contactInputProperties,
        },
        ContactPatch: {
          type: 'object',
          description:
            'Every field optional. `null` clears any optional field, and a ' +
            'blank string reads as `null`; `metadata` merges per RFC 7396 ' +
            'while `address` is replaced whole. A patch may not clear the ' +
            'last of `name`, `email` and `externalId` (400 ' +
            '`CONTACT_IDENTITY_REQUIRED`). Send `expectedUpdatedAt` from ' +
            'the last contact read to update only that revision: a stale ' +
            'one answers 409 `CONTACT_STALE` without changing any field.',
          additionalProperties: false,
          properties: {
            ...nullableProperties(contactInputProperties, ['source']),
            expectedUpdatedAt: expectedUpdatedAtProperty,
          },
        },
        BulkCreateResult: {
          type: 'object',
          required: ['success', 'failed', 'created', 'errors'],
          description:
            'A body the schema refuses fails the whole call with 400; a row ' +
            'the directory refuses (a duplicate email or external id) fails ' +
            'that row alone and is listed under `errors` with its code. ' +
            '`created` here is the list of rows that landed — unlike the ' +
            'boolean `created` a folder or task result carries.',
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
          required: ['id', 'name', 'createdAt', 'updatedAt'],
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
              description:
                'Caller-owned external key, unique per organization — ' +
                'stored NFC-normalized and trimmed',
            },
            archivedAt: {
              ...epochMs,
              description:
                'Epoch ms — present when the project is archived — the ' +
                'archived marker for lookups and the list',
            },
            createdAt: {
              ...epochMs,
              description: 'Epoch ms — the list is ordered on it, newest first',
            },
            updatedAt: {
              ...epochMs,
              description: 'Epoch ms of the last change to the project itself',
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
              ...epochMs,
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
            createdAt: epochMs,
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
              description:
                'The caller-owned natural key as stored — NFC-normalized ' +
                'and trimmed at intake',
            },
            externalUrl: { type: 'string' },
            description: { type: 'string' },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Resolved label names',
            },
            createdAt: epochMs,
            updatedAt: epochMs,
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
            runId: {
              type: 'string',
              nullable: true,
              description:
                'Present only when `runWorkflowSlug` was sent and the task ' +
                'was newly created: the started run’s id to poll, or null ' +
                'when the workflow did not start. Poll GET /api/v1/projects/{id}/runs/{runId}.',
            },
            executionId: {
              type: 'string',
              nullable: true,
              deprecated: true,
              description:
                'Alias of `runId` — the name this family shipped with; ' +
                'present exactly when `runId` is. Read `runId`.',
            },
          },
        },

        // ── Automations ──
        AutomationSummary: {
          type: 'object',
          additionalProperties: false,
          required: [
            'name',
            'latestVersion',
            'deployedVersion',
            'description',
            'inputs',
            'projectIds',
            'trigger',
          ],
          properties: {
            name: { type: 'string', description: 'The real `/`-slug' },
            latestVersion: int,
            deployedVersion: nullable({
              ...int,
              description: 'null while nothing is deployed',
            }),
            description: nullable({
              ...str,
              description:
                'The document’s `description` — the deployed version’s, else the newest saved one’s; null when neither declares one',
            }),
            inputs: nullable({
              ...obj,
              description:
                'The document’s `inputs` JSON Schema, chosen the same way — what a run input must match; null when the automation declares none',
            }),
            presentation: {
              description: 'The newest version’s display block, if authored',
            },
            trigger: nullable({
              type: 'object',
              required: ['kind', 'enabled'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['schedule', 'webhook', 'event'],
                },
                enabled: bool,
              },
              description:
                'What starts the automation, if a trigger is bound: its kind and whether it is switched on; null when none is. `GET …/triggers` has the rest.',
            }),
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
            createdAt: epochMs,
          },
        },
        AutomationVersion: {
          type: 'object',
          required: ['version', 'createdBy', 'createdAt', 'deployed'],
          properties: {
            version: int,
            message: nullable(str),
            testsPassed: nullable(bool),
            createdBy: str,
            createdAt: epochMs,
            deployed: {
              ...bool,
              description: 'Whether this is the version live runs execute',
            },
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
            lastFiredAt: nullable(epochMs),
          },
        },
        RunSummary: {
          type: 'object',
          description:
            'One run as a listing reports it — identity, scope, status and ' +
            'timing. The input, output, trace, effects and checkpoints of ' +
            'the full `Run` are inlined only when `include` names them; the ' +
            'single read answers the full row.',
          required: [
            'runId',
            'name',
            'version',
            'projectId',
            'status',
            'mode',
            'startedBy',
            'startedAt',
          ],
          properties: {
            runId: {
              ...str,
              description: 'The run id (`id` on the full read)',
            },
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
              description:
                '`api-key:<userId>` for runs started here, `trigger:<id>` for a trigger’s',
            },
            detail: {
              ...str,
              description: 'The failure or wait reason, when the run has one',
            },
            startedAt: epochMs,
            finishedAt: {
              ...epochMs,
              description: 'Epoch ms; absent while the run is not terminal',
            },
            input: { description: 'With `include=input`' },
            output: { description: 'With `include=output`' },
            trace: { description: 'With `include=trace`' },
            effects: { description: 'With `include=effects`' },
            checkpoints: { description: 'With `include=checkpoints`' },
          },
        },
        Run: {
          type: 'object',
          description:
            'A run in full — the single read: identity, status, input, ' +
            'output, trace, effects, and per-node checkpoints. Listings ' +
            'answer `RunSummary` rows.',
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
            startedAt: epochMs,
            finishedAt: nullable(epochMs),
          },
        },

        // ── Knowledge search ──
        KnowledgeHit: {
          type: 'object',
          required: [
            'id',
            'corpus',
            'text',
            'source',
            'chunkIndex',
            'score',
            'fusedScore',
          ],
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
                modifiedAt: nullable(epochMs),
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
                    'The active document that exposes `ref` in the hit’s own scope. For a Hub hit (`projectId` null) it is the id `GET /api/v1/documents/{id}` takes; for a project hit it is the file id the project routes take (`GET /api/v1/projects/{projectId}/files/{documentId}/content`, `DELETE …/files/{documentId}`) — `/api/v1/documents/{id}` answers 404 for a project file. Absent for web pages, thread uploads and emailed attachments',
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
            fusedScore: {
              ...num,
              minimum: 0,
              maximum: 1,
              description:
                'The rank-fusion order key the hits are sorted by — comparable only within one response (its normalization depends on how many legs answered); not a confidence, and not stable across searches',
            },
            legs: {
              ...int,
              minimum: 1,
              maximum: 2,
              description:
                'How many retrieval legs of the corpus found the passage: 2 when the keyword and the vector leg agreed, 1 when only one did',
            },
            rerankScore: {
              ...num,
              description: 'Present when a reranker ran and scored the hit',
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
              description:
                'In fused order (`fusedScore` descending), one passage per repeated text. The page is cut AFTER every candidate was checked against its live document, so `limit` never costs a readable hit',
            },
            diagnostics: {
              type: 'object',
              required: ['bm25', 'reranked', 'cached', 'admitted', 'legs'],
              properties: {
                bm25: {
                  ...bool,
                  description:
                    'False when the keyword index was unavailable and only the vector leg ran',
                },
                reranked: bool,
                cached: bool,
                admitted: {
                  ...int,
                  minimum: 0,
                  description:
                    'Fused candidates that passed the live-document check, before repeated passages were dropped and the page was cut',
                },
                legs: {
                  type: 'object',
                  additionalProperties: true,
                  description:
                    'How many hits each leg contributed before fusion — counts, keyed by leg (`documents:keyword`, `documents:dense`, `web:keyword`, `web:dense`, or `cache`)',
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
            archivedAt: {
              ...epochMs,
              description:
                'Epoch ms of the archive — present on an archived thread whose archive the deployment recorded; `updatedAt` does not move on archive or restore',
            },
            isShared: bool,
            generating: bool,
            createdAt: epochMs,
            updatedAt: {
              ...epochMs,
              description:
                'Epoch ms of the last message activity — archiving, restoring and renaming leave it untouched',
            },
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
                '`pending` is the placeholder a running turn fills in (the row GET …/generation names as messageId); `complete` is a settled reply; `cancelled` is a turn stopped through DELETE …/generation — `parts` and `usage` hold what had streamed; `failed` carries `error`.',
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
                'The token counters the finished turn recorded and the catalog cost estimate stamped beside them; absent until the turn settles, and absent on a turn that failed before the provider reported counts',
              properties: {
                inputTokens: {
                  ...int,
                  description:
                    'Prompt tokens — the assistant’s instructions and tool schemas included',
                },
                outputTokens: {
                  ...int,
                  description: 'Reply tokens, the reasoning share included',
                },
                cachedInputTokens: {
                  ...int,
                  description:
                    'The share of `inputTokens` the provider served from its prompt cache',
                },
                reasoningTokens: {
                  ...int,
                  description:
                    'The share of `outputTokens` spent thinking before the reply',
                },
                costEstimateCents: {
                  ...num,
                  minimum: 0,
                  description:
                    'The turn’s cost in US cents (fractional) from the catalog price the organization ledger also books — the same figure as the ledger; absent when the catalog publishes no price for the model',
                },
              },
            },
            createdAt: {
              ...epochMs,
              description:
                'Epoch ms — when the row was created (for an assistant row, when its turn started)',
            },
          },
        },

        // ── Agents & skills ──
        ProjectAgentInput: projectAgentInputSpec,
        ProjectAgentUpdate: projectAgentUpdateSpec,
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
            createdAt: epochMs,
            updatedAt: epochMs,
          },
        },
        SkillSummary: {
          type: 'object',
          required: ['slug', 'description', 'visibility', 'canEdit'],
          properties: skillSummaryProperties,
          additionalProperties: false,
        },
        Skill: {
          type: 'object',
          description:
            'The skill bundle: its summary fields plus the markdown body and the bundle’s file list',
          required: [
            'slug',
            'description',
            'visibility',
            'canEdit',
            'body',
            'files',
          ],
          properties: {
            ...skillSummaryProperties,
            body: {
              ...str,
              description:
                'The SKILL.md markdown after the frontmatter, as stored — always newline-terminated',
            },
            files: {
              type: 'array',
              description:
                'Every file of the bundle (SKILL.md included), sorted by path',
              items: {
                type: 'object',
                required: ['path', 'size'],
                properties: {
                  path: { ...str, description: 'Bundle-relative POSIX path' },
                  size: { ...int, description: 'Bytes' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
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
            documentId: {
              ...str,
              description:
                'The indexed Hub document the topic’s active version is stored in (`sourceProvider: knowledge`; `GET /api/v1/documents/{id}` reads it, `indexing` included). A direct delete or content edit of that document is refused — this entry is the way to change it',
            },
            supersededBy: {
              ...str,
              description: 'The row that replaced this one',
            },
            createdBy: str,
            createdAt: epochMs,
          },
        },
      },
    },
  };
}
