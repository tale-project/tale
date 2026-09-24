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
  PROJECT_SHARED_TEAMS_MAX,
  projectAgentInputSchema,
} from '@tale/shared/schemas/projects';
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
} from '@tale/shared/schemas/skills';
// ── Small builders ───────────────────────────────────────────────────────────
import { z } from 'zod';

import { RUN_FAILURE_CODES } from '../../backend/core/automations/failure.ts';
import { RAG_ERROR_CODES } from '../../backend/core/knowledge/rag_error_codes.ts';
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
import {
  PAGE_FAILURE_KINDS,
  SCAN_INTERVAL_VALUES,
  WEBSITE_STATUS_VALUES,
} from '../../backend/core/websites/types.ts';
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
import { TURN_FINISH_REASONS } from '../../lib/chat/types.ts';
import { CHAT_ERROR_CODES } from '../../lib/shared/chat-errors.ts';
import { API_CONTRACT_VERSION } from '../../lib/shared/constants/api-contract.ts';
import {
  API_EXTERNAL_ID_MAX_LENGTH,
  API_DELIVERY_STATUSES,
  API_SOURCE_PATTERN,
  apiDeliveryFailureSchema,
  apiSnapshotSchema,
} from '../../lib/shared/conversations/api-sync.ts';
import { EMITTED_EVENT_TYPES } from '../../lib/shared/event-types.ts';
import { dataSourceSchema } from '../../lib/shared/schemas/common.ts';
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
  '400': errorResponse(
    'Invalid request: a body the schema refuses — a wrong type, an unknown key, a missing field, a NUL or an unpaired surrogate, a whole number beyond 2^53 − 1 (`INVALID_BODY`, every problem under `data.issues`); a query parameter the operation does not take, given twice or left blank (`INVALID_QUERY`); on a list, a `limit` that is not a whole number (`INVALID_LIMIT`) or a `cursor` this list did not answer (`INVALID_CURSOR`)',
  ),
  '401': errorResponse('Missing or invalid API key (`UNAUTHORIZED`)'),
  '429': errorResponse(
    'The key holder’s request budget is spent (`RATE_LIMITED`): `Retry-After` names the wait in whole seconds and `data.retryAfterMs` in milliseconds; the envelope carries a `requestId`',
  ),
};

/**
 * The response headers the prose leans on, declared once so a client
 * generated from the document can read them — `Retry-After` was named in
 * 119 descriptions and declared in none, so the generated backoff had to
 * guess. Stamped by the post-pass below; the download operation adds its
 * own set.
 */
const responseHeaders: Record<string, Json> = {
  XRequestId: {
    description:
      'The request id the platform logged this call under — quote it when reporting a problem. Echoes a sane `X-Request-Id` the caller sent.',
    schema: { type: 'string' },
  },
  XTaleApiVersion: {
    description:
      'The version of this contract (`info.version`) the serving instance implements — semver for the wire',
    schema: { type: 'string', example: API_CONTRACT_VERSION },
  },
  Location: {
    description:
      'The created resource’s own path, relative to the request URL — follow it with GET whatever shape the 201 body has',
    schema: { type: 'string' },
  },
  RetryAfter: {
    description: 'How long to wait before retrying, in whole seconds',
    schema: { type: 'integer', minimum: 1 },
  },
  Allow: {
    description: 'The methods this path serves, comma-separated',
    schema: { type: 'string', example: 'GET, POST, HEAD, OPTIONS' },
  },
  WWWAuthenticate: {
    description:
      'The challenge RFC 9110 §11.6.1 requires of a 401: `Bearer`, or `Bearer error="invalid_token"` when a key was presented and refused',
    schema: { type: 'string' },
  },
  ContentDisposition: {
    description:
      'The stored file name as an RFC 6266 attachment (`filename` and `filename*`)',
    schema: { type: 'string' },
  },
  ETag: {
    description:
      'A validator: over the answer’s bytes on a JSON read, the stored object’s tag on a download. Send it back as `If-None-Match` — as received; the weak and edge-suffixed forms match too — to be told 304 when nothing changed.',
    schema: { type: 'string' },
  },
  CacheControl: {
    description:
      '`private, no-cache` on a validated read and on a download: keep the answer, revalidate it before reuse, and let no shared cache keep it. Every other answer says `no-store`.',
    schema: { type: 'string' },
  },
  LastModified: {
    description: 'When the stored object was last written (HTTP date)',
    schema: { type: 'string' },
  },
  AcceptRanges: {
    description: '`bytes` — `Range` requests are honoured',
    schema: { type: 'string', example: 'bytes' },
  },
  ContentRange: {
    description:
      'The satisfied range on a 206 (`bytes <start>-<end>/<size>`); on a 416, `bytes */<size>` names the file’s size',
    schema: { type: 'string' },
  },
  ContentLength: {
    description: 'The byte length of the response body',
    schema: { type: 'integer', minimum: 0 },
  },
};

function headerRef(name: keyof typeof responseHeaders): Json {
  return { $ref: `#/components/headers/${name}` };
}

/** Add declared headers to a response object, keeping any it already
 * names. */
function withHeaders(
  response: Json,
  headers: Record<string, keyof typeof responseHeaders>,
): void {
  const declared = (response.headers ?? {}) as Record<string, Json>;
  for (const [wire, component] of Object.entries(headers)) {
    declared[wire] ??= headerRef(component);
  }
  response.headers = declared;
}

/** The correlation id a caller may choose — stamped on every operation by
 * the post-pass. */
const requestIdHeaderParam = {
  name: 'X-Request-Id',
  in: 'header',
  required: false,
  description:
    'Your own correlation id, echoed back on the response and written to the platform’s log: up to 255 characters of letters, digits, `_`, `-` and `=`. Any other value is replaced by a fresh UUID (the response carries the id that was used), and uniqueness of an id you choose is yours to keep.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_=-]{1,255}$' },
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

/**
 * `x-tale-pagination` — the vendor extension every list envelope carries,
 * so a generated client (or a reader) learns the family from the schema,
 * not from the prose: `keyset` (`isDone` + `continueCursor`, taking
 * `cursor` + `limit`), `offset` (`total` + `offset` + `hasMore`, with the
 * keyset pair beside them), `none` (a complete set — no cursor, no
 * `isDone`, no `cursor`/`limit` parameter). The collection key stays the
 * resource's own; a generic pager reads `body.page ?? body[<resource>]`.
 * `spec.test.ts` holds every list operation to its declared family.
 */
const PAGINATION = 'x-tale-pagination';

/** `cursor` + `limit` for the keyset-paginated families: the previous
 * page's `continueCursor` comes back as `cursor`, on every list alike. */
function paginationParams(max: number, fallback: number) {
  return [
    queryParam(
      'cursor',
      'The previous page’s `continueCursor`, unchanged — opaque; omit for the first page. A value this list did not answer is refused with 400 `INVALID_CURSOR` rather than read as the first page',
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

/** A keyset page: `{page: [...], isDone, continueCursor}`. */
function pageOf(item: Json): Json {
  return {
    type: 'object',
    [PAGINATION]: 'keyset',
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

/** A named-array envelope: `{<name>: [...]}` — the complete set (or the
 * bounded roster the operation names), never a cursor walk: no `isDone`,
 * no cursor, and no `cursor`/`limit` parameter on the request. */
function listOf(name: string, item: Json, extra: Json = {}): Json {
  return {
    type: 'object',
    description: `The complete set under \`${name}\` — never paginated: no \`isDone\`, no cursor to follow`,
    [PAGINATION]: 'none',
    required: [name, ...Object.keys(extra)],
    properties: { [name]: { type: 'array', items: item }, ...extra },
  };
}

/** OAS 3.0: `nullable` widens the type, never the enum — a nullable enum
 * lists `null` itself, or a strict generated client rejects the `null` the
 * wire sends (a successful run's `failureCode`; 2026-09-14 evaluation, h1).
 * A Reference Object takes no siblings (§4.7.23 — `nullable` beside `$ref`
 * is ignored, so every generator typed the documented `{"ask": null}` as
 * non-null; 2026-09-19 evaluation, K9-1): the reference is wrapped in an
 * `allOf` the keyword can sit beside. And `nullable` needs a `type` in the
 * same Schema Object (§4.7.24): a typeless `oneOf`/`anyOf` carries it on
 * every branch instead (K9-2). `spec.test.ts` holds the document to both. */
const nullable = (schema: Json): Json => {
  if (typeof schema.$ref === 'string') {
    return { allOf: [schema], nullable: true };
  }
  const branches = Array.isArray(schema.oneOf)
    ? 'oneOf'
    : Array.isArray(schema.anyOf)
      ? 'anyOf'
      : null;
  if (schema.type === undefined && branches !== null) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the array test above
    const alternatives = schema[branches] as Json[];
    return { ...schema, [branches]: alternatives.map(nullable) };
  }
  const values = schema.enum;
  return {
    ...schema,
    nullable: true,
    ...(Array.isArray(values) && !values.includes(null)
      ? { enum: [...values, null] }
      : {}),
  };
};
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

/** The keys of a run — the `Run` schema in full, and the `RunProjection` a
 * `?fields=` read answers, share them so the two can never drift. */
const runProperties: Record<string, Json> = {
  id: { ...str, description: 'The run id (`runId` at start)' },
  organizationId: str,
  name: str,
  version: int,
  projectId: {
    ...nullable(str),
    description: 'URL project for a project run; null for an organization run',
  },
  status: {
    type: 'string',
    enum: ['queued', 'running', 'waiting', 'success', 'failed', 'cancelled'],
  },
  mode: { type: 'string', enum: ['mock', 'live'] },
  startedBy: {
    ...str,
    description:
      'What started the run — one of four forms: `api-key:<userId>` ' +
      '(a start through this API or the MCP endpoint), ' +
      '`user:<userId>` (a start from the product), ' +
      '`trigger:<triggerId>` (a schedule, webhook or event — the id ' +
      'the trigger read answers), or a bare user id on runs the ' +
      'in-product builder recorded before it prefixed them. Split ' +
      'on the first `:`; treat a value without one as a user id.',
  },
  input: {},
  output: {},
  checkpoints: {},
  trace: {},
  effects: {},
  detail: {
    ...nullable(str),
    description:
      'The failure or wait reason; null while the run has none — and null ' +
      'again once a cancel lands (the park it named is over). ' +
      'While `waiting` it names the park: `approval:<approvalId>`, ' +
      '`agent:<nodeId>` or `repeat:<nodeId>` — `waitingFor` is the ' +
      'field to branch on; when `failed`, the failure sentence, and ' +
      '`failureCode` the stable cause to branch on — the sentence is not ' +
      'contractual.',
  },
  failureCode: {
    ...nullable({ type: 'string', enum: [...RUN_FAILURE_CODES] }),
    description:
      'Why a `failed` run failed — present only with `status: "failed"`, ' +
      'null otherwise (and null on a failure recorded before this field ' +
      'existed). `node_error` — the node’s own code, template, `forEach` or ' +
      '`output` expression failed, an authoring refusal: the author’s ' +
      'problem; `connector_error` — a connector action refused or failed; ' +
      '`llm_output_invalid` — the model’s reply did not satisfy the node’s ' +
      '`outputSchema`; `approval_rejected`; `execution_limit` — the ' +
      '100-execution guard; `automation_deleted` — the automation vanished ' +
      'mid-flight. The provider codes the chat surface documents ' +
      '(`credit_exhausted`, `auth_error`, `rate_limited`, ' +
      '`provider_unreachable`, `provider_error`, `model_not_found`, …) — an ' +
      '`llm` node’s provider: the account or the provider, not the ' +
      'request. The agent codes (`harness_error`, `turn_crashed`, ' +
      '`session_gone`, `deadline`, `ask_expired`, `budget_exceeded`, …) — ' +
      'an `agent` node’s turn, after its in-node retries. Retry on ' +
      '`provider_error`, `provider_unreachable`, `rate_limited`, ' +
      '`turn_crashed`, `session_gone`, `harvest_failed`; alert a person on ' +
      'the rest.',
  },
  waitingFor: {
    type: 'string',
    enum: ['approval', 'ask', 'agent', 'repeat'],
    description:
      'Present only while `status` is `waiting`: what the run is ' +
      'parked on. `approval` — a person’s decision on a gate; `ask` ' +
      '— a question a person has to answer; `agent` — an agent turn ' +
      'still running, no one to page; `repeat` — a node polling ' +
      'until its `repeatUntil` condition holds, no one to page.',
  },
  claimEpoch: {
    ...int,
    description:
      'The stepper’s claim fence: incremented each time a worker claims the run (the first claim, a liveness re-poke, a queue retry); a worker holding an older epoch has its writes refused as stale. Diagnostic — above 1 means the run was re-claimed at least once.',
  },
  chainSeq: {
    ...int,
    description:
      'The poll-chain fence of a waiting run: incremented each time the run parks, so a wake-up scheduled for an earlier park is ignored. Diagnostic — how many times the run has parked.',
  },
  startedAt: {
    ...epochMs,
    description:
      'When the start was accepted — the 202 of a start, a webhook delivery or a trigger occurrence; the run is `queued` from this moment. There is no separate pick-up stamp: `queued` → `running` is the stepper’s first claim, usually within a second, so `finishedAt - startedAt` is wall-clock including any wait for a worker.',
  },
  finishedAt: nullable(epochMs),
};
const bool: Json = { type: 'boolean' };
const obj: Json = { type: 'object', additionalProperties: true };
const strArray: Json = { type: 'array', items: str };

/** The three health stamps of a trigger binding (the fire ledger, 0096),
 * read on `Trigger` and on the listing's `AutomationSummary.trigger` — one
 * definition, so the listing can never drift from the binding read. */
const triggerHealthProperties: Json = {
  lastFiredAt: {
    ...nullable(epochMs),
    description:
      'The last time this binding started a run (`GET …/triggers` names ' +
      'that run as `lastRunId`); null until it has. For a schedule this is ' +
      'the occurrence the run fired for (the minute the cron named); for a ' +
      'webhook or an event, the moment the delivery or the event was ' +
      'accepted. A rebind to another kind starts it afresh.',
  },
  lastSkippedAt: {
    ...nullable(epochMs),
    description:
      'The last time the binding came due (a schedule occurrence, an event, ' +
      'a webhook delivery) and started nothing — `lastSkipReason` says why; ' +
      'null until it has.',
  },
  lastSkipReason: {
    ...nullable({
      type: 'string',
      enum: ['not_deployed', 'unusable_cron', 'start_refused'],
    }),
    description:
      '`not_deployed`: the automation had no deployed version to run — ' +
      'deploy one. `unusable_cron`: the schedule’s expression or time zone ' +
      'could not be read; the scheduler leaves the binding alone until it ' +
      'is edited. `start_refused`: the deployed version’s `inputs` schema ' +
      'refused the run’s input (`{trigger, firedAt}` for a schedule).',
  },
};

/** Where a file-backed document stands in the search corpus — the one
 * vocabulary `Document.indexing` and `ProjectFile.indexing` share. */
const documentIndexing: Json = {
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
        '`pending` — never queued; `skipped` — the file opts out of indexing; `unsupported` — TERMINAL: the platform cannot index these bytes and a retry reproduces the answer, `errorCode` says why (`unsupported_type`, `image_no_vision`, `empty`, `not_text`, `malformed`); `failed` — see `error` / `errorCode`: the job retries `embedding_upstream`, `indexer_error` and `index_rebuilding` by itself, the rest wait for an admin (a provider account, the organization’s policy) and a `retry-indexing`',
    },
    indexedAt: {
      ...epochMs,
      description: 'Epoch ms of the last completed indexing',
    },
    error: {
      ...str,
      description:
        'A sentence for a person, present with `failed` and `unsupported`; never a storage-engine diagnostic — the raw cause stays in the platform log.',
    },
    errorCode: {
      type: 'string',
      enum: [...RAG_ERROR_CODES],
      description:
        'The stable cause to branch on, present with `failed` and `unsupported`. Terminal (`unsupported`): `unsupported_type` — no extractor for the type; `image_no_vision` — an image and no OCR lane; `empty` — no text to index; `not_text` — binary bytes behind a text extension, re-export as UTF-8; `malformed` — the bytes do not parse as the format the extension claims. Retried by the job (`failed`): `embedding_upstream` — the provider was unreachable, rate-limited or 5xx; `indexer_error` — a platform-side store fault; `index_rebuilding` — the search index is being rebuilt. Waits for an admin (`failed`): `embedding_not_configured`, `embedding_provider_refused` (the provider refused the account or credential, or the model answers vectors of another width than the settings state), `index_repair_failed`, `secret_detected`, `pii_blocked`. Saving corrected embedding settings re-queues every document that failed on the embedding model.',
    },
  },
};

/** The conditional-read parameters both download doors take — a project
 * file's and a Hub document's — declared once so the two cannot drift:
 * the Hub door used to declare neither while honouring both (round e). */
const fileConditionalParams = [
  {
    name: 'If-None-Match',
    in: 'header',
    required: false,
    schema: { type: 'string' },
    description:
      'The `ETag` a previous answer carried (as received — the ' +
      'compressing edge suffixes the tag of a text file it ' +
      'compressed, and that form matches too): unchanged bytes ' +
      'answer 304 with no body. Takes precedence over ' +
      '`If-Modified-Since`.',
  },
  {
    name: 'If-Modified-Since',
    in: 'header',
    required: false,
    schema: { type: 'string' },
    description:
      'The `Last-Modified` a previous answer carried: bytes not ' +
      'modified since answer 304 with no body, judged at the whole-second ' +
      'precision an HTTP date carries. Ignored when `If-None-Match` is ' +
      'present. On a content-only Hub document the date is the ' +
      'document’s own `updatedAt`, which a title or metadata patch moves ' +
      'too — `If-None-Match` follows the bytes alone.',
  },
];

/** The 304 both download doors answer. */
const fileNotModified = {
  description:
    'Not Modified — `If-None-Match` named the current `ETag` (or ' +
    '`If-Modified-Since` the current `Last-Modified`), so no bytes ' +
    'are sent; `ETag`, `Last-Modified` and `Accept-Ranges` ride along',
  headers: {
    ETag: headerRef('ETag'),
    'Last-Modified': headerRef('LastModified'),
    'Cache-Control': headerRef('CacheControl'),
  },
};

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
      'execution — one the managed lane runs unattended on the platform’s ' +
      'own credentials; `GET /api/v1/models` lists them under `harnesses`. ' +
      'Every equipment field is checked ' +
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
  phone: {
    ...str,
    maxLength: CONTACT_PHONE_MAX,
    description:
      'Trimmed — digits and phone punctuation only (`+`, spaces, ' +
      'dashes, parentheses, dots); at least one digit',
  },
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
      'a `javascript:` or `ftp:` URL) answers 400. The host is held to the ' +
      'crawl-target rule by name and by IP literal — loopback, link-local, ' +
      'private-network (RFC 1918, CGNAT, ULA, `.internal`/`.lan`-style ' +
      'suffixes, single-label names) and cloud metadata hosts answer 400 ' +
      '`INVALID_BODY` — as a string, without a DNS lookup: a public name that ' +
      'resolves to a private address passes here. The platform never fetches ' +
      'the URL; the rule keeps a stored URL from becoming a server-side ' +
      'request later. `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` lifts the ' +
      'private-network half, never the metadata half. Exception: an exact ' +
      'managed product-image URL returned by this deployment may be replayed, ' +
      'including on a private deployment. It must name registered image ' +
      'metadata in this organization that the caller uploaded or a current ' +
      'product already uses; a missing or inaccessible image answers 404 ' +
      '`FILE_NOT_FOUND`. The app accepts inspected PNG, JPEG, WebP, GIF, or SVG uploads up to 5 MiB. Its bytes require an authorized app session; an API key does not authorize this app route.',
  },
  stock: safeNumber,
  price: safeNumber,
  currency: {
    ...str,
    // Any case in, upper-cased before storing — the pattern must admit lower
    // case too, or a generated client rejects `"eur"` the door accepts
    // (2026-09-18 evaluation, J7-1).
    pattern: '^[A-Za-z]{3}$',
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
  etag: {
    ...str,
    description:
      'The strong entity tag of the bundle’s SKILL.md — the quoted SHA-256 of its content, the `ETag` the GET carries and the value a conditional save sends back as `If-Match`. Moves with every save of the document; the bundle’s other files never move it',
  },
  updatedAt: {
    ...epochMs,
    description: 'When SKILL.md was last written',
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
    'may omit it; a blank or whitespace-only value reads as the header ' +
    'absent. The 400 lists the slugs the key holder may send under ' +
    '`data.organizations`; `GET /api/v1/me` answers them too.',
};

// ── The spec ─────────────────────────────────────────────────────────────────

export function buildSpec(): Json {
  const paths: Record<string, Json> = {};
  paths['/api/v1/notifications/sync'] = {
    get: {
      tags: ['Notifications'],
      operationId: 'listNotificationsForSync',
      summary: 'Read a member’s notifications for one-way mirroring',
      security: sec,
      description:
        'Organization owners and administrators may export the personal and organization streams of an active, verified member identified by email — and so may any other member an administrator delegated the export to by granting the `tale:notifications.export` capability in the organization’s competence register (organization-scoped, optionally expiring, revocable, and revoked when the membership ends); `GET /api/v1/me` answers `capabilities.notificationExport`. Security visibility follows the recipient’s role. Missing, disabled, unverified or ambiguous recipients return an empty completed page. Walk both streams completely before retracting missing destination rows; failed scans must preserve the previous mirror. This endpoint never marks Tale notifications read. Source ids are stable and org-prefixed; version changes with content or read state. Paths use the same destinations as the Tale bell, relative to the configured browser origin (which may require ZeroTier), never the machine transport URL. Text uses the requested locale or the organization default, with English fallback; titles and bodies are bounded to 500 and 8000 characters.',
      parameters: [
        orgSlugHeaderParam,
        ...paginationParams(100, 100),
        {
          ...queryParam(
            'recipientEmail',
            'Verified email of the intended recipient',
          ),
          required: true,
          schema: { type: 'string', format: 'email', maxLength: 320 },
        },
        {
          ...queryParam(
            'stream',
            'Walk each stream independently with its own cursor',
          ),
          required: true,
          schema: { type: 'string', enum: ['personal', 'organization'] },
        },
        {
          ...queryParam('locale', 'Defaults to the organization’s language'),
          schema: { type: 'string', enum: ['en', 'de', 'fr'] },
        },
      ],
      responses: {
        ...standardErrors,
        '403': errorResponse(
          'The key holder is neither an organization owner or administrator nor holds a live `tale:notifications.export` capability grant (`ROLE_FORBIDDEN`)',
        ),
        '200': jsonResponse('One page of the recipient’s stream', {
          type: 'object',
          [PAGINATION]: 'keyset',
          required: ['recipientId', 'page', 'isDone', 'continueCursor'],
          properties: {
            recipientId: nullable(str),
            isDone: bool,
            continueCursor: { type: 'string' },
            page: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                required: [
                  'id',
                  'version',
                  'title',
                  'body',
                  'path',
                  'createdAt',
                  'read',
                ],
                properties: {
                  id: { type: 'string' },
                  version: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  title: { type: 'string', maxLength: 500 },
                  body: { type: 'string', maxLength: 8000 },
                  path: {
                    type: 'string',
                    description:
                      'Organization-scoped /dashboard/ path with encoded entity ids and query parameters',
                  },
                  createdAt: { type: 'integer', minimum: 0 },
                  read: bool,
                },
              },
            },
          },
        }),
      },
    },
  };

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
        '`CONVERSATION_CONTACT_TRASHED` (the linked contact is in the trash — ' +
        'restore it or send a `deleted` teardown), ' +
        '`CONTACT_AMBIGUOUS`, `DELIVERY_UNACKNOWLEDGED`, ' +
        '`DELIVERY_RECEIPT_CONFLICT`, `DELIVERY_RETRY_UNAVAILABLE`, ' +
        '`CONVERSATION_CLOSED` (the source tore the mirror down — a content ' +
        'snapshot onto it, or an Inbox reply to it)',
    ),
  };
  const conversationOperation = {
    tags: ['Conversations'],
    security: sec,
    parameters: [conversationOrg],
  };
  /** The handle a staged upload answers and a snapshot or delivery echoes:
   * opaque on the wire — a client persists and repeats it unchanged. */
  const opaqueStorageId: Json = {
    ...str,
    description:
      'Opaque — persist and echo it unchanged; its shape is not part of the contract',
  };
  const snapshotState = {
    type: 'object',
    required: [
      'conversationId',
      'organizationId',
      'version',
      'externalContactId',
      'contactId',
      'contactStatus',
      'sourceDeleted',
      'status',
      'attachments',
    ],
    properties: {
      conversationId: str,
      organizationId: str,
      version: int,
      externalContactId: {
        ...str,
        description:
          'The bound contact’s current `externalId`: the one named on first mirror, following a rename of that same contact (a PATCH of its `externalId`, or a snapshot naming the new id) — never re-resolved to a different row.',
      },
      contactId: {
        ...nullable(str),
        description:
          'The bound contact row — `GET /api/v1/contacts/{id}` takes it; null when no contact row is linked (`contactStatus: "missing"`).',
      },
      contactStatus: {
        type: 'string',
        enum: ['active', 'trashed', 'missing'],
        description:
          'The linked contact’s state: `active`, `trashed` (a `DELETE /contacts/{id}` retired it — further content snapshots answer 409 `CONVERSATION_CONTACT_TRASHED` until it is restored with `POST /api/v1/contacts/{id}/restore` or in the app; a `deleted` teardown closes the mirror but does not lift the refusal), or `missing` (no contact row is linked).',
      },
      sourceDeleted: {
        ...bool,
        description:
          'The source tore the mirror down with a `deleted` snapshot: the Inbox thread is closed and a later content snapshot answers 409 `CONVERSATION_CLOSED` at any version — mirror the source conversation under a new `externalId` to start again. An engine that resumes from this receipt reads it before pushing its next snapshot; it is the one field that says a teardown landed.',
      },
      status: {
        ...nullable(str),
        description:
          'The Inbox conversation’s status — `closed` once torn down; null only when the Inbox row itself is gone (`contactStatus: "missing"`).',
      },
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'storageId'],
          properties: { id: str, storageId: opaqueStorageId },
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
        'sends — every organization the holder belongs to, and ' +
        '`capabilities`: the gates a deployment knob or a grant decides rather ' +
        'than the role alone (`deploymentEditor` — whether `POST /api/v1/browser-sessions/import` ' +
        'and `DELETE /api/v1/browser-sessions/{id}` would pass their gate; ' +
        '`notificationExport` — whether `GET /api/v1/notifications/sync` would, ' +
        'by role or through a `tale:notifications.export` grant). ' +
        '`key` names the API key that made the request — its `name` and ' +
        'its `expiresAt` (epoch ms, `null` for a key minted to never ' +
        'expire) — so an unattended caller can rotate before the 401. ' +
        'Keys are minted, rotated and revoked in the app (Settings > API > ' +
        'REST): no operation on this surface creates, lists or revokes one.',
      operationId: 'getMe',
      security: sec,
      parameters: [orgSlugHeaderParam],
      responses: {
        '200': jsonResponse('The caller and its organizations', ref('Me')),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/teams'] = {
    get: {
      tags: ['Organization'],
      summary: 'List the organization’s teams',
      description:
        'Every team of the organization, by name, as a complete set (not ' +
        'paginated) — the ids a team audience takes: `teamIds` on a project ' +
        'or a document, `teams` on a skill. Any key holder may read it (a ' +
        'team’s name is what every audience badge shows); `member` says ' +
        'whether the key holder belongs to the team — the teams a holder ' +
        'who is not an organization admin may put a project or document ' +
        'in, so a caller pre-flights `TEAM_ACCESS_DENIED` instead of ' +
        'learning it from a 403. Teams are created, renamed and staffed in ' +
        'the app (Settings > Teams) or by an identity provider; no ' +
        'operation on this surface writes one.',
      operationId: 'listTeams',
      security: sec,
      parameters: [orgSlugHeaderParam],
      responses: {
        '200': jsonResponse(
          'The organization’s teams',
          listOf('teams', ref('Team')),
        ),
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
        'Returns the current source revision, the bound contact (`contactId`, the row; `externalContactId`, its current external id), its `contactStatus` (`active` | `trashed` | `missing`), whether the source tore the mirror down (`sourceDeleted`, with the Inbox `status`) and attachment refs for safe crash recovery — an engine that resumes reads `sourceDeleted` before pushing its next snapshot, because a content snapshot onto a torn-down mirror answers 409 `CONVERSATION_CLOSED` at any version. A `trashed` status means the contact was deleted and further content snapshots answer 409 `CONVERSATION_CONTACT_TRASHED` until it is restored (`POST /api/v1/contacts/{id}/restore`). `GET /api/v1/conversations?source=` lists every mirror. An unknown or differently owned source returns a null snapshot.',
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
        // The receipt never refuses by source or contact: an unknown or
        // differently owned source is `snapshot: null`, so the family's
        // 403/404/409 codes are not this read's (2026-09-14 evaluation,
        // g7-7d — `CONVERSATION_SOURCE_NOT_FOUND` was declared here and is
        // unreachable here). The door-wide 400/401/429 remain, and the
        // post-pass adds the tenant-header refusals.
        ...standardErrors,
        '403': errorResponse('A read-only role (`ROLE_FORBIDDEN`)'),
      },
    },
    post: {
      ...conversationOperation,
      operationId: 'synchronizeConversationSource',
      summary: 'Apply a complete native Inbox source snapshot',
      description:
        'Creates an API-channel Inbox conversation linked to exactly one contact.externalId — a contact that must already exist: `externalContactId` names the `externalId` of a contact in this organization (create it through `POST /api/v1/contacts` first); an id no contact carries answers 404 `CONTACT_NOT_FOUND` and one that more than one contact carries 409 `CONTACT_AMBIGUOUS`, nothing applied. A snapshot never re-homes a conversation: it is bound to a contact ROW, so a contact re-keyed in the CRM (a PATCH of its `externalId`) keeps its conversations — a snapshot naming the contact’s current id applies and the receipt follows it — while an `externalContactId` that names a different contact, or no live one, answers 409 `CONVERSATION_CONTACT_CONFLICT` naming the id the conversation is bound to; deleting the contact and recreating it under the same `externalId` (a common CRM re-import) is a different row and never transfers the thread to the new person. A content snapshot for a conversation whose contact has been moved to the trash answers 409 `CONVERSATION_CONTACT_TRASHED` — restore the contact (`POST /api/v1/contacts/{id}/restore`) to continue it; a `deleted` teardown closes the mirror but does not reopen it, so a later content snapshot answers the same 409 while the contact stays in the trash; the `contactStatus` on the `GET` receipt reports this. Source + externalId is owned by the API key user; key rotation preserves ownership. A newer integer version replaces only source-receipted messages; an older version does nothing; the same version with different content returns 409. Message IDs must be unique. A message that began life as a native Inbox reply — one this integration claimed through the deliveries lane — carries `taleMessageId`, that reply’s `messageId`, and must have been acknowledged under its `externalId` first (409 `DELIVERY_UNACKNOWLEDGED` otherwise); a message without `taleMessageId` is the source’s own, whatever `isCustomer` says. Every attachment a message names must have been staged through `POST /api/v1/conversations/uploads` by this key user and still be within its window — one never staged, lapsed, malformed or another organization’s answers 400 `ATTACHMENT_NOT_STAGED`, another service user’s upload in this organization 403 `ATTACHMENT_NOT_OWNED` — at the declared `size` (400 `ATTACHMENT_SIZE_MISMATCH` when the landed bytes disagree) — nothing of the snapshot is applied on any of these refusals. `replyConstraints` bounds what a person’s Inbox reply to the conversation may carry — body length, attachment count, size and extensions — and is enforced when that reply is written, never against a snapshot. A deleted snapshot closes the source and has no messages: it is not content, so it applies at the stored version or any higher one (a source whose versions ran out can still tear its mirror down) and replays as a no-op once the source is torn down. A torn-down mirror stays down: a later content snapshot at any version answers 409 `CONVERSATION_CLOSED` (the receipt’s `sourceDeleted` says so) — mirror the source conversation under a new `externalId` to start again. Unacknowledged office replies are preserved. Unknown keys are refused. JSON is limited to 8 MiB.',
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
        '400': errorResponse(
          'Invalid body (`INVALID_BODY`), an attachment never staged, whose window lapsed or whose `storageId` this door never handed out (`ATTACHMENT_NOT_STAGED`), or one whose declared size the landed bytes contradict (`ATTACHMENT_SIZE_MISMATCH`)',
        ),
        '413': errorResponse(
          'The body exceeds 8 MiB — this operation’s own cap, above the door’s 1 MiB default, sized for a whole source snapshot (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
      },
    },
  };
  paths['/api/v1/conversations/assignment'] = {
    post: {
      ...conversationOperation,
      operationId: 'assignConversationTeam',
      summary: 'Queue a mirrored conversation to a team',
      description:
        'Sets the team a conversation this key user mirrored is queued to, or clears it with `teamId: null` — the team’s members can then open it in the Inbox, and each of them is notified. The conversation is named like every mirror route, by `source` and its `externalId`; team ids come from `GET /api/v1/teams`. Admin and owner keys only — the Inbox’s own rule for who may assign; an editor key answers 403 `ROLE_FORBIDDEN` and can route by a governance rule for its source instead. A team outside the organization answers 400 `TEAM_NOT_IN_ORG`; a mirror no snapshot created answers 404 `CONVERSATION_NOT_FOUND`, one another service user owns 403 `INTEGRATION_NOT_OWNED`. Setting the team it already has changes nothing. The person assignee is not touched. Unknown keys are refused.',
      requestBody: jsonBody({
        type: 'object',
        required: ['source', 'externalId', 'teamId'],
        additionalProperties: false,
        properties: {
          source: { type: 'string', pattern: API_SOURCE_PATTERN.source },
          externalId: {
            type: 'string',
            minLength: 1,
            maxLength: API_EXTERNAL_ID_MAX_LENGTH,
          },
          teamId: nullable({
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description:
              'A team id from `GET /api/v1/teams`; `null` clears the team',
          }),
        },
      }),
      responses: {
        '200': jsonResponse('The conversation’s team as it now stands', {
          type: 'object',
          required: ['conversationId', 'assigneeTeamId'],
          properties: {
            conversationId: str,
            assigneeTeamId: nullable(str),
          },
        }),
        ...standardErrors,
        '400': errorResponse(
          'Invalid body (`INVALID_BODY`), or a team outside this organization (`TEAM_NOT_IN_ORG`)',
        ),
        '403': errorResponse(
          'A role below admin (`ROLE_FORBIDDEN`), or an integration another service user owns (`INTEGRATION_NOT_OWNED`)',
        ),
        '404': errorResponse(
          'No conversation is mirrored under that `source` and `externalId` (`CONVERSATION_NOT_FOUND`)',
        ),
      },
    },
  };
  paths['/api/v1/conversations'] = {
    get: {
      ...conversationOperation,
      operationId: 'listConversations',
      summary: 'List the conversations you mirrored',
      description:
        'Every conversation this key user mirrored under a source, newest first — the reconciliation read: `conversationId`, the source `externalId`, the bound contact (`contactId`, the row; `externalContactId`, its current external id) and its `contactStatus`, the stored `version`, whether the source tore the mirror down (`sourceDeleted`), and the Inbox `status` and `subject`. `contactStatus=trashed` finds the mirrors a deleted contact froze. Paginated: pass `continueCursor` back as `cursor` until `isDone`. A source no snapshot ever named answers 404 `CONVERSATION_SOURCE_NOT_FOUND`, one only other service users own 403 `INTEGRATION_NOT_OWNED`.',
      parameters: [
        conversationOrg,
        {
          ...queryParam('source', 'The source whose mirrors to list'),
          required: true,
          schema: { type: 'string', pattern: API_SOURCE_PATTERN.source },
        },
        {
          ...queryParam('contactStatus', 'One contact state to narrow to'),
          schema: { type: 'string', enum: ['active', 'trashed', 'missing'] },
        },
        ...paginationParams(200, 50),
      ],
      responses: {
        '200': jsonResponse('The mirrors, newest first', {
          type: 'object',
          [PAGINATION]: 'keyset',
          required: ['conversations', 'isDone', 'continueCursor'],
          properties: {
            conversations: {
              type: 'array',
              items: ref('ConversationMirror'),
            },
            isDone: bool,
            continueCursor: {
              type: 'string',
              description:
                'Pass back as `cursor` for the next page; empty when `isDone`',
            },
          },
        }),
        ...conversationErrors,
      },
    },
  };
  paths['/api/v1/conversations/deliveries'] = {
    get: {
      ...conversationOperation,
      operationId: 'listConversationDeliveries',
      summary: 'Peek at the delivery queue',
      description:
        'The queue of a source this key user mirrored, as it stands — no lease taken, nothing changed: every native reply queued for the source with its `status` (`queued` — the undo window, a backoff, a lapsed lease; `leased` while a claim’s lease runs; `failed` once dead-lettered; `delivered` once acknowledged), its attempt count and stamps, and never the claim token or the body — those only a claim earns. Oldest-due first (`retryAt`, then `messageId`), the order a claim drains it in; `status` narrows to one state. Paginated: pass `continueCursor` back as `cursor` until `isDone`. A source no snapshot ever named answers 404 `CONVERSATION_SOURCE_NOT_FOUND`, one only other service users own 403 `INTEGRATION_NOT_OWNED`.',
      parameters: [
        conversationOrg,
        {
          ...queryParam('source', 'The source whose queue to read'),
          required: true,
          schema: { type: 'string', pattern: API_SOURCE_PATTERN.source },
        },
        {
          ...queryParam('status', 'One state to narrow the queue to'),
          schema: { type: 'string', enum: [...API_DELIVERY_STATUSES] },
        },
        ...paginationParams(200, 50),
      ],
      responses: {
        '200': jsonResponse('The queue, oldest-due first', {
          type: 'object',
          [PAGINATION]: 'keyset',
          required: ['deliveries', 'isDone', 'continueCursor'],
          properties: {
            deliveries: {
              type: 'array',
              items: ref('ConversationDelivery'),
            },
            isDone: bool,
            continueCursor: {
              type: 'string',
              description:
                'Pass back as `cursor` for the next page; empty when `isDone`',
            },
          },
        }),
        ...conversationErrors,
      },
    },
  };
  paths['/api/v1/conversations/deliveries/{id}/retry'] = {
    post: {
      ...conversationOperation,
      operationId: 'retryConversationDelivery',
      summary: 'Re-drive a dead-lettered delivery',
      description:
        'Puts a delivery that dead-lettered — a permanent refusal, or ten transient failure reports — back in the queue, claimable at once with its attempt count reset: the same audited action as the Inbox’s Retry. No body. A delivery this key user does not own under the id is absent (404 `DELIVERY_NOT_FOUND`); one that is not dead-lettered — still queued or leased, already delivered — or whose conversation the source tore down or closed answers 409 `DELIVERY_RETRY_UNAVAILABLE`.',
      parameters: [
        conversationOrg,
        pathParam('id', 'The native message ID the delivery carries'),
      ],
      responses: {
        '200': jsonResponse('Re-queued', {
          type: 'object',
          required: ['ok'],
          properties: { ok: bool },
        }),
        ...conversationErrors,
        '404': errorResponse(
          'No delivery owned by this user (`DELIVERY_NOT_FOUND`)',
        ),
        '409': errorResponse(
          'Not dead-lettered, or its conversation is gone (`DELIVERY_RETRY_UNAVAILABLE`)',
        ),
      },
    },
  };
  paths['/api/v1/conversations/deliveries/claim'] = {
    post: {
      ...conversationOperation,
      operationId: 'claimConversationDeliveries',
      summary: 'Poll queued native Inbox replies',
      description:
        'Claims up to 100 due replies for a source owned by this API key user — a source no snapshot ever named answers 404 `CONVERSATION_SOURCE_NOT_FOUND`, one only other service users own 403 `INTEGRATION_NOT_OWNED`, so a mistyped source never polls a healthy-looking empty queue. Claim closes undo and grants a five-minute visibility lease. Unacknowledged deliveries become eligible again after their lease/backoff, in `retryAt`, `availableAt`, `messageId` order — the stamps `GET /api/v1/conversations/deliveries` shows without claiming. Each item says where it stands: `attempts` (failure reports so far), `leaseExpiresAt` (when this claim’s lease ends), `lastErrorCode` (the last failure’s code, `null` before one) and `firstClaimedAt`. Use stable messageId as the destination idempotency key and claimToken when reporting a failure. JSON is limited to 64 KiB.',
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
              'attempts',
              'leaseExpiresAt',
              'lastErrorCode',
              'firstClaimedAt',
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
              attempts: {
                ...int,
                description:
                  'Failure reports so far — the tenth transient one dead-letters the delivery',
              },
              leaseExpiresAt: {
                ...epochMs,
                description:
                  'When this claim’s visibility lease ends and the delivery becomes claimable again',
              },
              lastErrorCode: nullable({
                ...str,
                description:
                  'The code of the last failure report; `null` before one',
              }),
              firstClaimedAt: {
                ...epochMs,
                description:
                  'The first claim of this delivery — this one, unless it is a redelivery',
              },
              attachments: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['storageId', 'filename', 'contentType', 'size'],
                  properties: {
                    storageId: opaqueStorageId,
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
        '413': errorResponse(
          'The body exceeds 64 KiB — this operation’s own cap, below the door’s 1 MiB default (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
      },
    },
  };
  paths['/api/v1/conversations/deliveries/{id}/fail'] = {
    post: {
      ...conversationOperation,
      operationId: 'failConversationDelivery',
      summary: 'Report a refused or interrupted delivery',
      description:
        'Idempotent for the claimToken; stale claims cannot fail a new attempt or an acknowledged reply. A permanent refusal, or ten transient failure reports, dead-letters the delivery: it leaves the claim queue, shows `failed` in `GET /api/v1/conversations/deliveries`, exposes native Inbox Retry/Discard, and `POST /api/v1/conversations/deliveries/{id}/retry` re-drives it. Transient failures retry after 1, 2, 4 minutes up to one hour. Only static error codes are accepted. JSON is limited to 64 KiB.',
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
        '413': errorResponse(
          'The body exceeds 64 KiB — this operation’s own cap, below the door’s 1 MiB default (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
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
        '413': errorResponse(
          'The body exceeds 64 KiB — this operation’s own cap, below the door’s 1 MiB default (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
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
        'Uploads at most 30 MiB to this organization and records an upload intent owned by this key user. Bind the storageId, actual size and filename in a snapshot within two hours. Previously receipted refs can be reused on later source revisions. There is no delete: a staged upload that is never bound is reclaimed lazily — after the two-hour window plus a 24-hour grace, on the next upload into the organization — while a bound ref lives and dies with its message. An empty body answers 400 `FILE_SIZE_INVALID` — there is nothing to stage — and one over the cap 413 `BODY_TOO_LARGE`.',
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
          properties: { storageId: opaqueStorageId },
        }),
        '413': errorResponse(
          'The body exceeds 30 MiB — this operation’s own cap, above the door’s 1 MiB default, the staging cap the description names (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
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
        '`content` is not carried in the listing; read one document for its ' +
        'inline text, or `GET /api/v1/documents/{id}/content` for the bytes.',
      operationId: 'listDocuments',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('sourceProvider', 'Only documents from this source'),
        queryParam(
          'folderId',
          'Only documents inside this folder — a folder id, or `root` for ' +
            'the documents in no folder. Omit it to list the whole hub, ' +
            'whatever folder a document sits in.',
        ),
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
        'or a `retry-indexing`. The body may run to 32 MiB — this ' +
        'operation’s own cap, sized for the 5,000,000-character inline ' +
        '`content`; past it the answer is 413 `BODY_TOO_LARGE`.',
      operationId: 'createDocument',
      security: sec,
      requestBody: jsonBody(ref('DocumentInput')),
      responses: {
        '201': createdId('Created — the new document’s id'),
        '403': errorResponse(
          'The key holder’s role cannot write documents, `teamIds` (or `teamId`) names a team a non-admin key holder is not in (`TEAM_ACCESS_DENIED`), or `folderId` names a Hub folder shared with a team the key holder is not in (`FOLDER_NOT_ACCESSIBLE`)',
        ),
        '404': errorResponse(
          'The upload is absent, not owned by the key holder or already bound',
        ),
        '413': errorResponse(
          'The body exceeds 32 MiB — this operation’s own cap, above the door’s 1 MiB default, sized for a 5,000,000-character inline `content` (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
        ...standardErrors,
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`); `teamIds` names a team that is not this organization’s (`TEAM_NOT_IN_ORG`, the ids in `data.teamIds`); or `folderId` is a team folder and `teamIds` names a team outside its audience (`TEAM_INHERITED_FROM_FOLDER`) — inside a team folder the folder’s audience applies',
        ),
      },
    },
  };

  paths['/api/v1/documents/{id}'] = {
    get: {
      tags: ['Documents'],
      summary: 'Get document',
      description:
        'A document’s metadata, its `indexing` state and — for a ' +
        'content-only document — its inline `content`; `content` is null ' +
        'for a file-backed document, whose bytes are at ' +
        '`GET /api/v1/documents/{id}/content`. A project file, a foreign ' +
        'document and a nonexistent id all answer the same opaque 404 ' +
        '(`DOCUMENT_NOT_FOUND`).',
      operationId: 'getDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('The document', ref('Document')),
        '404': errorResponse('Document not found (`DOCUMENT_NOT_FOUND`)'),
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
        'has its `updatedAt`. `metadata` MERGES per RFC 7396 — sent keys ' +
        'are set, omitted keys stay, a key sent as `null` is removed, the ' +
        'whole field sent as `null` clears it. A patch that changes ' +
        'nothing — an empty body, or every field already at its value — ' +
        'writes nothing and leaves `updatedAt` alone, so it never spends ' +
        'another client’s `expectedUpdatedAt`. A document that backs an ' +
        'active knowledge entry keeps its title, content, MIME type and ' +
        'extension through the entry (update the entry instead); a ' +
        'folder, team or metadata change goes through. The body may run to ' +
        '32 MiB — this operation’s own cap, sized for the 5,000,000-character ' +
        'inline `content`; past it the answer is 413 `BODY_TOO_LARGE`.',
      operationId: 'updateDocument',
      security: sec,
      parameters: [
        pathParam('id', 'Document ID'),
        {
          name: 'If-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'The `ETag` you last read from `GET /api/v1/documents/{id}` — strong comparison, so a `W/` tag never matches — or `*`: the update applies only while the document’s current representation still carries that tag; otherwise 412 `PRECONDITION_FAILED`, `data.etag` naming the current tag, nothing written. The tag covers the whole read, `indexing` included, so a document mid-index answers 412 until it settles; `expectedUpdatedAt` in the body remains the row-level precondition (409 `DOCUMENT_STALE`). Absent, the header is not evaluated.',
        },
      ],
      requestBody: jsonBody(ref('DocumentPatch')),
      responses: {
        '200': {
          ...jsonResponse(
            'The document as it now stands — the shape `GET` answers, `updatedAt` included — with the `ETag` of that representation, the value the next `If-Match` sends',
            ref('Document'),
          ),
          headers: { ETag: headerRef('ETag') },
        },
        '403': errorResponse(
          'The key holder’s role cannot write documents, `teamIds` (or `teamId`) names a team a non-admin key holder is not in (`TEAM_ACCESS_DENIED`), or `folderId` names a Hub folder shared with a team the key holder is not in (`FOLDER_NOT_ACCESSIBLE`)',
        ),
        '404': errorResponse('Document not found (`DOCUMENT_NOT_FOUND`)'),
        '409': errorResponse(
          'The record is protected (`DOCUMENT_RECORD_PROTECTED`); the document changed since it was read (`DOCUMENT_STALE` — reload and merge); or it backs an active knowledge entry and the change touches its title, content, MIME type or extension (`DOCUMENT_HAS_KNOWLEDGE_ENTRY`, `data.entryId` names the entry to update instead)',
        ),
        '412': errorResponse(
          'The `If-Match` tag does not strongly match the document’s current representation (`PRECONDITION_FAILED`, `data.etag` naming the current tag); nothing written — reload, merge, and send the current `ETag`',
        ),
        ...standardErrors,
        '400': errorResponse(
          'Invalid request (malformed body or parameters); `teamIds` names a team that is not this organization’s (`TEAM_NOT_IN_ORG`); the document sits in (or moves into) a team folder and `teamIds` names a team outside its audience (`TEAM_INHERITED_FROM_FOLDER`); or the patch touches the content, MIME type, extension or source provider of a controlled record — frozen while in review or approved (`DOCUMENT_RECORD_FROZEN`, `data.state`), or a draft whose bytes move only through the attested replacement flow (`DOCUMENT_RECORD_REPLACEMENT_REQUIRED`)',
        ),
        '413': errorResponse(
          'The body exceeds 32 MiB — this operation’s own cap, above the door’s 1 MiB default, sized for a 5,000,000-character inline `content` (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
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
        '404': errorResponse('Document not found (`DOCUMENT_NOT_FOUND`)'),
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
        'Re-queues a Knowledge Hub document’s blob for indexing; a project ' +
        'file answers 404 here — its own door is `POST ' +
        '/api/v1/projects/{id}/files/{documentId}/retry-indexing`, the ' +
        'same core behind it. Requires a ' +
        'documents-write role. The same guards as the app’s Index now: a ' +
        'budget of 10 retries per user per minute (429 `RATE_LIMITED`, ' +
        '`Retry-After` names the wait), and `skipped` — honestly, with the ' +
        '`reason` — for a content-only document (`content-only`: inline ' +
        'text never enters the search corpus, only file-backed documents ' +
        'do), a blob the platform does not track (`untracked-blob`), a ' +
        'file type no extractor can read (`unsupported` — terminal; the ' +
        'document’s `indexing.error` says why), or a fresh index job ' +
        'already queued or running (`in-progress` — poll the document’s ' +
        '`indexing` instead). A file that opted out of indexing when it ' +
        'was uploaded is opted back in by the retry — the explicit request ' +
        'is the opt-in — so it queues and answers `indexing`; it used to ' +
        'answer `skipped` with `rag-opt-out`, a reason no longer given.',
      operationId: 'retryDocumentIndexing',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse(
          'Whether indexing was queued',
          ref('RetryIndexingResult'),
        ),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse(
          'Document not found (`DOCUMENT_NOT_FOUND`) — a project file ' +
            'included: retry it through its project door',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/documents/{id}/content'] = {
    get: {
      tags: ['Documents'],
      summary: 'Download a document',
      description:
        'The bytes of a Knowledge Hub document — what `GET /api/v1/documents/{id}` ' +
        'cannot carry for a file-backed one: an uploaded file, and the ' +
        'document every knowledge entry mints. Streamed in the response ' +
        'itself (**200**, no redirect to follow), with the document’s title ' +
        'in an RFC 6266 `Content-Disposition` (`filename` and `filename*`), ' +
        'the stored `Content-Type`, `Content-Length`, `ETag` and ' +
        '`Last-Modified`; `Range` is honoured (206, or a bodiless 416 for a ' +
        'range the file cannot satisfy) and a HEAD request answers the ' +
        'headers alone — `Content-Length`, `ETag`, `Last-Modified`, ' +
        '`Accept-Ranges` — ignoring `Range`. ' +
        'A content-only document answers its inline text the same way — ' +
        'typed as its `mimeType` (`text/plain` when it has none), UTF-8, ' +
        '`Accept-Ranges: none` — so every Hub document reads back from this ' +
        'one URL, and `If-None-Match` and `If-Modified-Since` are judged ' +
        'against the `ETag` and `Last-Modified` issued on both kinds (a ' +
        'bodiless 304). A project file, a foreign document, a nonexistent id and a ' +
        'file whose bytes the store no longer holds all answer the same ' +
        'opaque 404 (`DOCUMENT_NOT_FOUND`). A store that does not answer is ' +
        'a 503 with `Retry-After`.',
      operationId: 'downloadDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID'), ...fileConditionalParams],
      responses: {
        '200': {
          description: 'The bytes, named by `Content-Disposition`',
          headers: {
            'Content-Disposition': headerRef('ContentDisposition'),
            'Content-Length': headerRef('ContentLength'),
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Accept-Ranges': headerRef('AcceptRanges'),
          },
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '206': {
          description:
            'The bytes of a satisfied `Range` on a file-backed document; ' +
            '`Content-Range` names the slice and the file’s size. Ranges are ' +
            'clamped to the file; a `Range` the server cannot read is ' +
            'ignored and the whole file answers 200',
          headers: {
            'Content-Range': headerRef('ContentRange'),
            'Content-Disposition': headerRef('ContentDisposition'),
            'Content-Length': headerRef('ContentLength'),
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Accept-Ranges': headerRef('AcceptRanges'),
          },
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '416': {
          description:
            'The range starts at or past the end of the file: an empty ' +
            'body (`Content-Length: 0`), no envelope, `Content-Range: bytes ' +
            '*/<size>` naming the size',
          headers: {
            'Content-Range': headerRef('ContentRange'),
            'Accept-Ranges': headerRef('AcceptRanges'),
            'Content-Length': headerRef('ContentLength'),
          },
        },
        '304': fileNotModified,
        '404': errorResponse('Document not found (`DOCUMENT_NOT_FOUND`)'),
        '503': errorResponse(
          'The object store did not serve the file ' +
            '(`OBJECT_STORE_UNAVAILABLE`, with `Retry-After`) or none is ' +
            'configured (`OBJECT_STORE_UNCONFIGURED`)',
        ),
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
        {
          ...queryParam(
            'status',
            'Only websites in this scan status — `scanning`, `active`, `error` or `deleting`; any other value answers 400 `INVALID_QUERY` naming the set (it used to answer an empty page; `idle` was declared and never observable, and left the set in 1.11.0)',
          ),
          schema: { type: 'string', enum: [...WEBSITE_STATUS_VALUES] },
        },
        {
          ...queryParam(
            'scanInterval',
            'Only websites on this scan interval — `60m`, `6h`, `12h`, `1d`, `5d`, `7d` or `30d`; any other value answers 400 `INVALID_QUERY` naming the set (it used to answer an empty page)',
          ),
          schema: { type: 'string', enum: [...SCAN_INTERVAL_VALUES] },
        },
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
        'With `urls`, registers (or, for a domain already registered AS A ' +
        'LIST, extends) a curated URL list instead of a whole-site crawl. ' +
        'The host is stored as given — `www.` is kept — and the `www.` and ' +
        'apex spellings count as one site: a domain already registered, ' +
        'under either spelling, is a 409 unless the post extends a list; ' +
        '`data.websiteId` and `data.domain` name the existing row. ' +
        'Discovery honours the site’s `robots.txt` `Disallow` rules for ' +
        'the `*` agent on every path a URL can enter by — the sitemap, the ' +
        'link walk and the links a rendered page reveals — and a page a ' +
        'rule covers is never fetched; a page a rule added later covers ' +
        'leaves the index on the next scan. Listed URLs are exempt: an ' +
        'explicit list is your instruction.',
      operationId: 'createWebsite',
      security: sec,
      requestBody: jsonBody(ref('WebsiteInput')),
      responses: {
        '201': createdId('Created — the website’s id'),
        '200': jsonResponse(
          'With `urls`, the domain was already registered as a list under ' +
            'this exact spelling: its URLs were extended and this is the ' +
            'EXISTING website’s id',
          {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
        ),
        '409': errorResponse(
          'The domain is already registered (`WEBSITE_DUPLICATE_DOMAIN`): ' +
            'as a whole-site crawl (a URL list never extends one — the ' +
            'row keeps its kind and nothing is queued), without `urls` on ' +
            'a list, or under its `www.`/apex sibling; `data.websiteId` ' +
            'and `data.domain` name the existing row, so a list can be ' +
            're-posted under the stored spelling',
        ),
        ...standardErrors,
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), a `domain` that names ' +
            'no https host (`WEBSITE_DOMAIN_INVALID` — `http://`, a ' +
            'non-default port and a bare IP address are refused: the ' +
            'crawler dials https on 443, by host name), a domain the crawl ' +
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
        '`limit`, default 100), answering `{pages, total, offset, hasMore}` ' +
        'and, beside them, the keyset pair every other list answers: ' +
        '`isDone`, and a `continueCursor` that stands for the next `offset` ' +
        '— pass it back as `cursor` until `isDone`, the one loop for every ' +
        'list. `cursor` and `offset` together answer 400 `INVALID_QUERY`.',
      operationId: 'listWebsitePages',
      security: sec,
      parameters: [
        pathParam('id', 'Website ID'),
        queryParam(
          'cursor',
          'The previous window’s `continueCursor`, unchanged — opaque; the ' +
            'alternative to `offset`, never beside it. A value this list ' +
            'did not answer is refused with 400 `INVALID_CURSOR`',
        ),
        {
          ...queryParam(
            'offset',
            'Rows to skip (default 0). A whole number: a negative value is ' +
              'clamped to 0, while a fractional or non-numeric one answers ' +
              '400 `INVALID_QUERY`',
          ),
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
        {
          ...queryParam(
            'limit',
            'Rows to return, 1..500 (default 100). A whole number: an ' +
              'out-of-range value is clamped, a fractional or non-numeric one ' +
              'answers 400 `INVALID_LIMIT`',
          ),
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        },
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
        'immediately; `syncing` means the job is queued, not finished. The ' +
        'job is keyed per website: a second call while one is still queued ' +
        'or running folds into it — two calls answer `syncing` twice and ' +
        'run once — so calling after every crawl costs nothing extra. The ' +
        'row is also synced on the crawler’s own cadence — after discovery, ' +
        'after every stored batch, at each link’s end and at the scan’s end ' +
        '— so polling GET /api/v1/websites/{id} without this door follows a ' +
        'running scan. Takes no body.',
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
        '400': errorResponse(
          'A body that is not empty JSON — this operation takes none (`INVALID_BODY`)',
        ),
      },
    },
  };

  paths['/api/v1/websites/{id}/search'] = {
    post: {
      tags: ['Websites'],
      summary: 'Search content',
      description:
        'A POST because it carries a body, not because it writes: keyword ' +
        '(BM25) search over this website’s crawled content — no dense leg, ' +
        'so no `similarity`; for that, `POST /api/v1/knowledge/search` with ' +
        '`corpus: "web"`. Answers `{results, ' +
        'total}` — each result its `url`, `title`, `content`, `chunkIndex` ' +
        'and `score` — a shape of its own, not the `{hits, diagnostics}` of ' +
        'the two knowledge-search doors (a different corpus); `limit` is a ' +
        'body field, so a value outside 1..100 is refused with 400 ' +
        '`INVALID_BODY` naming it, never clamped — the rule every body ' +
        'number follows.',
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
            minimum: 1,
            maximum: 100,
            description:
              'Matches to return, 1..100 (default 10); a value outside the ' +
              'range, or not a whole number, answers 400 `INVALID_BODY` ' +
              'naming `limit` — a body field is never clamped',
          },
        },
      }),
      responses: {
        ...standardErrors,
        '200': jsonResponse('Matches', ref('WebsiteSearchResults')),
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`, the field named ' +
            'under `data.issues`): a blank `query`, an unknown key, or a ' +
            '`limit` outside 1..100 or not a whole number',
        ),
        '404': errorResponse('Website not found (`WEBSITE_NOT_FOUND`)'),
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
        'jar itself is never returned. A complete set, not paginated.',
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
        '`DELETE /api/v1/browser-sessions/{id}` revokes it earlier. ' +
        '`GET /api/v1/me` says in advance whether this key passes the gate ' +
        '(`capabilities.deploymentEditor`).',
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
        'its lifetime — behind the same gate as the import (`GET /api/v1/me` ' +
        'answers it in advance as `capabilities.deploymentEditor`). An id ' +
        'the organization does not hold answers 404.',
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
      description:
        'Most recently updated first — ordered by `updatedAt`, then `id`, both descending; the cursor is that pair, so a product updated (or created) while you page moves ahead of the cursor and is not served again in that pass. A full reconciliation re-runs the pass until two consecutive passes agree, or compares `updatedAt` per record. Filters combine with AND.',
      operationId: 'listProducts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        {
          ...queryParam(
            'status',
            'Only products in this status — the closed set the write side takes; any other value answers 400 `INVALID_QUERY` naming the set',
          ),
          schema: { type: 'string', enum: [...PRODUCT_STATUSES] },
        },
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
        'One product by id; a deleted product or one in another organization answers 404 `PRODUCT_NOT_FOUND`.',
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
        'Deletes the product permanently — products have no trash and no restore, unlike contacts: its `name` and `externalId` are free for a new product at once (a re-created product is a new row with a new id, so a catalog sync must re-key anything it holds on the old one). A product already deleted answers 404 `PRODUCT_NOT_FOUND`.',
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
      description:
        'Most recently updated first; trashed contacts are hidden. Ordered by `updatedAt`, then `id`, both descending; the cursor is that pair, so a contact updated (or created) while you page — an inbound conversation touching it, a colleague’s edit — moves ahead of the cursor and is not served again in that pass. A full reconciliation re-runs the pass until two consecutive passes agree, or compares `updatedAt` per record. Filters combine with AND; `source` is the closed set the write side takes, any other value answers 400 `INVALID_QUERY`.',
      operationId: 'listContacts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        {
          ...queryParam(
            'source',
            'Only contacts from this source — the closed set the write side takes; any other value answers 400 `INVALID_QUERY` naming the set (it used to answer an empty page)',
          ),
          schema: { type: 'string', enum: [...dataSourceSchema.options] },
        },
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
        'and names each failed row with its reason — a row the schema ' +
        'refuses (a malformed email, an unknown key, a missing identity) ' +
        'fails ALONE, reported under `errors[]` as `INVALID_BODY` with its ' +
        'field-named `issues`, while every valid row lands; only the ' +
        'batch’s own shape — the `contacts` array, 1..500 rows, no other ' +
        'top-level key — answers 400 `INVALID_BODY` for the whole call. The ' +
        'body may run to 8 MiB — this operation’s own cap; past it the ' +
        'answer is 413 `BODY_TOO_LARGE`.',
      operationId: 'bulkCreateContacts',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['contacts'],
        additionalProperties: false,
        properties: {
          contacts: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            description:
              'At least one row — an empty batch is a 400 `INVALID_BODY`, ' +
              'never a 201 that created nothing',
            items: ref('ContactInput'),
          },
        },
      }),
      responses: {
        '201': jsonResponse('Bulk creation result', ref('BulkCreateResult')),
        '413': errorResponse(
          'The body exceeds 8 MiB — this operation’s own cap, above the door’s 1 MiB default, sized for 500 contacts with 10,000-character notes (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/{id}/restore'] = {
    post: {
      tags: ['Contacts'],
      summary: 'Restore a contact from the trash',
      operationId: 'restoreContact',
      description:
        'Puts a trashed contact back in the directory — the remedy a frozen conversation mirror’s 409 `CONVERSATION_CONTACT_TRASHED` names — under the create’s own rule: a live contact that has since taken its email or external id refuses the restore with 409 `CONTACT_DUPLICATE_EMAIL` or `CONTACT_DUPLICATE_EXTERNAL_ID`, so a restore never mints a twin. A contact not in the trash is a no-op that answers the contact; one that does not exist answers 404 `CONTACT_NOT_FOUND`. Its mirrored conversations resume with it — a content snapshot at a higher version applies again. Takes no body.',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      responses: {
        '200': jsonResponse(
          'The contact, live again (or still live)',
          ref('Contact'),
        ),
        '404': errorResponse('Contact not found (`CONTACT_NOT_FOUND`)'),
        '409': errorResponse(
          'A live contact took the email (`CONTACT_DUPLICATE_EMAIL`) or the external id (`CONTACT_DUPLICATE_EXTERNAL_ID`) meanwhile',
        ),
        ...standardErrors,
        '400': errorResponse(
          'A body that is not empty JSON — this operation takes none (`INVALID_BODY`)',
        ),
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
        'Optionally send expectedUpdatedAt from the last contact read. The update locks and checks that revision atomically; a stale revision returns 409 CONTACT_STALE without changing any field. A patch that changes nothing — an empty body, or every field already at its value — writes nothing and leaves `updatedAt` alone (the document rule), so it never spends another client’s `expectedUpdatedAt`; a write that changes something advances `updatedAt`, even within one millisecond. Omit the precondition for the existing unconditional behavior. A changed `externalId` carries through to the conversations mirrored onto this contact: their receipts name the new id and a snapshot naming it applies, while the old id names no live contact and is refused (409 `CONVERSATION_CONTACT_CONFLICT`).',
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
        'Move the contact to the trash, which frees its email and external id for a new contact; a contact already there answers 404 `CONTACT_NOT_FOUND`. Any mirrored conversation still linked to this contact keeps its messages but stops accepting content snapshots — `POST /api/v1/conversations/sync` answers 409 `CONVERSATION_CONTACT_TRASHED` for it, and its `GET` receipt reports `contactStatus: "trashed"` — until the contact is restored (`POST /api/v1/contacts/{id}/restore`, or the app’s Trash); a `deleted` teardown closes such a mirror but does not reopen it. Because the external id is freed, it is never re-resolved for an existing conversation, so a contact recreated under the same id never inherits the old one’s history.',
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
        '`archived` (400 `INVALID_QUERY`); it is one whole page and says so ' +
        '(`isDone: true`, an empty `continueCursor`). Without it: the LIST ' +
        'of every project the key holder can see, newest first, keyset-paged ' +
        'like every other list — `{projects, isDone, continueCursor}`, pass ' +
        '`continueCursor` back as `cursor` until `isDone`. While more pages ' +
        'remain the answer also carries `cursor`, the same token under its ' +
        'pre-1.5.0 name — deprecated, served for at least two more minor ' +
        'versions. Archived projects are excluded ' +
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
        ...paginationParams(100, 25),
      ],
      responses: {
        '200': jsonResponse(
          'The lookup’s zero or one matching project, or one page of the list',
          {
            type: 'object',
            [PAGINATION]: 'keyset',
            required: ['projects', 'isDone', 'continueCursor'],
            properties: {
              projects: { type: 'array', items: ref('Project') },
              isDone: {
                type: 'boolean',
                description:
                  'True when no more pages remain — a lookup is one whole ' +
                  'page and says so',
              },
              continueCursor: {
                type: 'string',
                description:
                  'Pass back as `cursor` for the next page; empty when ' +
                  '`isDone` (a lookup answers it empty)',
              },
              cursor: {
                type: 'string',
                deprecated: true,
                description:
                  'The same token as `continueCursor`, present only while ' +
                  'more pages remain — the pre-1.5.0 spelling, served for ' +
                  'at least two more minor versions; read `continueCursor`',
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
        'the name when omitted — omitted, not blank: a key that is blank ' +
        'once trimmed is the same 400 `INVALID_BODY` a blank `name` is; a ' +
        'derived key that is already taken gets a ' +
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
              'Trimmed; whitespace alone is a 400 `INVALID_BODY`, not an ' +
              'omitted key. Letters and digits only, starting with a ' +
              'letter (`PROJECT_KEY_INVALID` otherwise); normalized to ' +
              'uppercase, never truncated. An explicit key that is taken ' +
              'is a 409.',
            minLength: 2,
            maxLength: 6,
            pattern: '^[A-Za-z][A-Za-z0-9]{1,5}$',
          },
          description: { type: 'string', maxLength: 500 },
          teamIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
            maxItems: PROJECT_SHARED_TEAMS_MAX + 1,
            description:
              'The audience: the teams that may see the project, by id — ' +
              'teams of this organization (`GET /api/v1/teams` lists them), ' +
              'and for a key holder who is not an admin, teams they belong ' +
              'to (`TEAM_ACCESS_DENIED`). Omitted or empty = ' +
              'organization-wide. A repeated id collapses to one, first-seen ' +
              'order kept — the stored list is what the response echoes, as ' +
              'on documents and skills. Owners and admins see every project ' +
              'regardless.',
          },
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
          'A body the schema refuses (`INVALID_BODY` — a `teamIds` past its ' +
            '`maxItems` included), an explicit `key` outside the 2-6 ' +
            'letters-and-digits rule (`PROJECT_KEY_INVALID`), or a ' +
            '`teamIds` that names a team that is not this organization’s ' +
            '(`PROJECT_SHARING_INVALID`, the unknown ids in ' +
            '`data.unknownTeamIds`); a repeated team id collapses to one',
        ),
        '403': errorResponse(
          'The key holder is not an org editor (`ROLE_FORBIDDEN`), or ' +
            '`teamIds` names a team a non-admin key holder is not in ' +
            '(`TEAM_ACCESS_DENIED`)',
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
      summary:
        'Update a project — archive, restore, rename, re-describe, re-attach its externalItemId',
      description:
        'The project’s mutable surface, every field optional and at least ' +
        'one required. `archived: true` archives the project, `false` ' +
        'restores it — the same action as the app, so it requires an ' +
        'organization admin (403 `ROLE_FORBIDDEN` otherwise); a project ' +
        'already in the requested state is left unchanged, and a body that ' +
        'changes nothing — every field already at its value — writes ' +
        'nothing and leaves `updatedAt` alone. Archiving keeps ' +
        'the project and everything in it readable through this door and ' +
        'refuses every write on it (403 `PROJECT_ARCHIVED`); its ' +
        '`externalItemId` stays taken until the project is deleted. ' +
        '`name`, `description` and `externalItemId` are the identity a ' +
        'mirror propagates when the source record changes: for the org ' +
        'editor role with project edit access (403 `ROLE_FORBIDDEN` / ' +
        '`RBAC_FORBIDDEN` otherwise) on an active project — a body that ' +
        'restores and edits applies the restore first, one that edits and ' +
        'archives applies the archive last, and identity edits on an ' +
        'archived project the body does not restore answer 403 ' +
        '`PROJECT_ARCHIVED`. `name` is trimmed and never blank; ' +
        '`description: null` clears it; `externalItemId` is stored ' +
        'canonical (NFC, trimmed), must be free within the organization ' +
        '(409 `PROJECT_DUPLICATE_EXTERNAL_ID`, the key in `data`), and ' +
        '`null` releases it. An invisible or absent project answers the ' +
        'opaque 404. Answers the project as it now stands.',
      operationId: 'setProjectArchived',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        description:
          'At least one of the fields; a body with none is refused ' +
          '(`INVALID_BODY`)',
        properties: {
          archived: bool,
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            description: 'Trimmed, never blank',
          },
          description: {
            type: 'string',
            nullable: true,
            maxLength: 500,
            description: '`null` clears it',
          },
          externalItemId: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 256,
            description:
              'The caller-owned key, stored NFC-normalized and trimmed, ' +
              'unique per organization; `null` releases it',
          },
          teamIds: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 128 },
            maxItems: PROJECT_SHARED_TEAMS_MAX + 1,
            description:
              'The audience, replaced whole: the teams that may see the ' +
              'project, by id (teams of this organization — `GET ' +
              '/api/v1/teams` lists them); `[]` makes it organization-wide, ' +
              'a repeated id collapses to one, and the audience the project ' +
              'already carries is a no-op that leaves `updatedAt` alone. An ' +
              'organization admin verb, like `archived` — a lesser role ' +
              'answers 403 `RBAC_FORBIDDEN` — and, like every other write, ' +
              'refused on an archived project the body does not restore ' +
              '(403 `PROJECT_ARCHIVED`).',
          },
        },
      }),
      responses: {
        ...standardErrors,
        '200': jsonResponse('The project as it now stands', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`): no field, an unknown ' +
            'key, a blank `name` or `externalItemId`, a value past its cap ' +
            '(`teamIds` past its `maxItems` included); or a `teamIds` that ' +
            'names a team that is not this organization’s ' +
            '(`PROJECT_SHARING_INVALID`, the unknown ids in ' +
            '`data.unknownTeamIds`)',
        ),
        '403': errorResponse(
          '`archived` or `teamIds` from a key holder who is not an ' +
            'organization admin, ' +
            'or an identity edit without the editor role (`ROLE_FORBIDDEN`) ' +
            'or project edit access (`RBAC_FORBIDDEN`, `PROJECT_FORBIDDEN`), ' +
            'or on an archived project the body does not restore ' +
            '(`PROJECT_ARCHIVED`)',
        ),
        '404': errorResponse('Project not found'),
        '409': errorResponse(
          '`externalItemId` is another project’s key in this organization ' +
            '(`PROJECT_DUPLICATE_EXTERNAL_ID`, the canonical key in `data`) ' +
            '— nothing was written',
        ),
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
        'the organization instead. Agents, folders and the project’s run ' +
        'history — finished runs included, unlike an automation delete, ' +
        'which keeps its runs — go with the project either way, and its ' +
        '`externalItemId` becomes free again. The ' +
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
        'run project agents (`PROJECT_AGENT_HARNESS_INVALID` — `data.harnesses` names the eligible set, the one `GET /api/v1/models` lists); a provider ' +
        'this organization has no credential for ' +
        '(`PROJECT_AGENT_PROVIDER_UNKNOWN`) or a model it cannot call, or ' +
        'that only a subscription bound to another harness serves ' +
        '(`PROJECT_AGENT_MODEL_INVALID`) — `GET /api/v1/models` lists the ' +
        'pairs; a tool grant outside the catalog ' +
        '(`PROJECT_AGENT_TOOL_UNKNOWN`), a skill the project cannot see ' +
        '(`PROJECT_AGENT_SKILL_UNKNOWN`), a connector the organization ' +
        'has not connected (`PROJECT_AGENT_CONNECTOR_UNKNOWN`) or a secret ' +
        'name the organization has not stored ' +
        '(`PROJECT_AGENT_SECRET_UNKNOWN` — `data.secrets` names them); or ' +
        'the 50-agent limit (`PROJECT_AGENT_LIMIT`)',
    ),
    '403': errorResponse(
      'Project is not editable or is archived, or the caller changes secret ' +
        'grants without being an organization admin ' +
        '(`PROJECT_AGENT_SECRETS_FORBIDDEN`)',
    ),
    '404': errorResponse(
      'Project is missing or invisible, or the agent does not belong to ' +
        'this project (`PROJECT_AGENT_NOT_FOUND`)',
    ),
    '409': errorResponse(
      'A name another agent of this project already carries, compared ' +
        'without regard to case (`PROJECT_AGENT_NAME_TAKEN`) — reuse that ' +
        'agent or pick another name; nothing is written',
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
        'Invalid configuration, an unknown secret name (refused by name — ' +
        '`PROJECT_AGENT_SECRET_UNKNOWN` — never pruned on this door), or ' +
        'exceeding the limit answers 400; a name another agent of the ' +
        'project already carries answers 409 (`PROJECT_AGENT_NAME_TAKEN`).',
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
        'send the whole configuration you mean to keep. A body that names ' +
        'the configuration already stored writes nothing and leaves ' +
        '`updatedAt` alone (the document rule), so two declarative writers ' +
        're-asserting one configuration never 409 each other. Pass the ' +
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
        ...projectAgentErrors,
        '409': errorResponse(
          '`expectedUpdatedAt` is older than the agent’s `updatedAt` ' +
            '(`PROJECT_AGENT_STALE`), or the new name is another agent’s ' +
            'in this project, compared without regard to case ' +
            '(`PROJECT_AGENT_NAME_TAKEN`) — nothing was written',
        ),
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
      summary:
        'List the project’s folders — the roots, or one folder’s children',
      description:
        'The root folders, or with `parentId` the children of that folder ' +
        '— one level at a time, NOT paginated (a project holds a handful ' +
        'of period folders per level, not an unbounded tree); walk the ' +
        'tree level by level, or resolve a file’s `folderId` with ' +
        '`GET …/folders/{folderId}`. Every folder carries its `parentId` ' +
        '(null at the root). A `parentId` that is not a folder of THIS ' +
        'project answers the opaque 404 (`FOLDER_NOT_FOUND`).',
      operationId: 'listProjectFolders',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        queryParam(
          'parentId',
          'List the children of this folder (a folder of this project) ' +
            'instead of the root folders',
          { type: 'string' },
        ),
      ],
      responses: {
        '200': jsonResponse(
          'The folders of that level, each with its `parentId`',
          listOf('folders', ref('ProjectFolder')),
        ),
        '404': errorResponse(
          'Project not found, or `parentId` is not a folder of this project (`FOLDER_NOT_FOUND`)',
        ),
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
        'folder (the sibling rule is database-enforced). `name` is trimmed ' +
        'and NFC-normalized; a name that is a path (`a/b`, `a\\b`, `.`, ' +
        '`..`) or carries a control character is refused ' +
        '(`FOLDER_NAME_INVALID` — the sentence names the rule broken and ' +
        '`data.issues` names `name`) — the rule a file name and a WebDAV ' +
        'segment follow — and a parent 20 levels ' +
        'deep refuses a child (`FOLDER_DEPTH_EXCEEDED`). `parentId` must ' +
        'name a folder of THIS project (an opaque 404 otherwise); omit it ' +
        'for a root folder — a blank id is a 400 `INVALID_BODY`. ' +
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
              'Trimmed and NFC-normalized; matched against siblings ' +
              'without regard to case. No path separators (`/`, `\\`), no ' +
              'control characters, not `.` or `..`.',
          },
          parentId: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            description:
              'Parent folder id (a folder of this project) — present with ' +
              'a value, or omitted for a root folder; blank is refused',
          },
        },
      }),
      responses: {
        ...standardErrors,
        '200': jsonResponse('The existing folder', ref('ProjectFolderResult')),
        '201': jsonResponse('The created folder', ref('ProjectFolderResult')),
        '400': errorResponse(
          'A body the schema refuses (`INVALID_BODY`), a name that is a ' +
            'path or carries a control character (`FOLDER_NAME_INVALID`, ' +
            'the sentence naming the rule and `data.issues` naming `name`), ' +
            'or a parent at the depth cap (`FOLDER_DEPTH_EXCEEDED`)',
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
    get: {
      tags: ['Projects'],
      summary: 'Get a project folder',
      description:
        'One folder of this project with its `parentId` (null at the ' +
        'root) — what a file’s `folderId` resolves to, and, parent by ' +
        'parent, its path. A folder of another project or organization, ' +
        'or an absent id, answers the same opaque 404 (`FOLDER_NOT_FOUND`).',
      operationId: 'getProjectFolder',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('folderId', 'Folder ID'),
      ],
      responses: {
        '200': jsonResponse('The folder', {
          type: 'object',
          required: ['folder'],
          properties: { folder: ref('ProjectFolder') },
        }),
        '404': errorResponse(
          'Project or folder not found (`FOLDER_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
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
        'the bind — a name without an extension included, whatever ' +
        '`contentType` says — 400 `UPLOAD_POLICY_REJECTED` / ' +
        '`UNSUPPORTED_FILE_TYPE` before anything is presigned, so the ' +
        'bytes never travel. The ' +
        'answer names `maxBytes`, the largest file this organization ' +
        'accepts for the declared type (the platform ceiling, 100 MiB, or ' +
        'the organization’s lower cap); declare `size` and the size and ' +
        'volume caps are judged here too — 400 `FILE_TOO_LARGE` / ' +
        '`UPLOAD_POLICY_REJECTED` with `data.limitBytes` — where they were ' +
        'discoverable only by uploading past them (the bind judges the ' +
        'landed bytes against the same caps; the declared size is a ' +
        'pre-check, never compared with what landed, so understating it ' +
        'buys nothing). A handoff never bound — or bound and refused — is ' +
        'reclaimed lazily: 24 hours after its 30-minute expiry, on the ' +
        'next mint into the organization, the blob is deleted with the ' +
        'intent, so a crashed worker leaves no permanent orphan and needs ' +
        'no delete call. Requires the org editor role and project edit ' +
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
                'characters; trimmed and NFC-normalized first) ending in ' +
                'an extension the upload policy and the format allowlist ' +
                'accept (a name without one is refused whatever ' +
                '`contentType` says) — so a bad name fails here, before ' +
                'the bytes are uploaded; the bind’s `fileName` is what is ' +
                'stored.',
            },
            contentType: { type: 'string', maxLength: 255 },
            size: {
              type: 'integer',
              minimum: 0,
              description:
                'Optional. The bytes about to be uploaded: a size the bind ' +
                'would refuse — over the platform ceiling ' +
                '(`FILE_TOO_LARGE`), over the organization’s cap for the ' +
                'type, or past the key holder’s volume quota ' +
                '(`UPLOAD_POLICY_REJECTED`) — fails here, before anything ' +
                'is presigned. The bind judges the landed size regardless.',
            },
          },
        },
        false,
      ),
      responses: {
        ...standardErrors,
        '200': jsonResponse('The upload handoff', ref('ProjectUploadHandoff')),
        '400': errorResponse(
          'Malformed body (`INVALID_BODY`); `fileName` names a type the ' +
            'organization’s upload policy (`UPLOAD_POLICY_REJECTED`) or ' +
            'the platform’s format allowlist (`UNSUPPORTED_FILE_TYPE`) ' +
            'refuses; or `size` is over the platform ceiling ' +
            '(`FILE_TOO_LARGE`, `data.limitBytes`), the organization’s cap ' +
            'or the volume quota (`UPLOAD_POLICY_REJECTED`, ' +
            '`data.reasonCode` `file_too_large` / `volume_exceeded`)',
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
    get: {
      tags: ['Projects'],
      summary: 'Read one project file',
      description:
        'The row `GET /api/v1/projects/{id}/files` lists — `fileName`, ' +
        '`folderId`, `mimeType`, `size` and where the file stands in the ' +
        'search corpus (`indexing`) — for one file, so a poller waiting for ' +
        'ONE upload’s `indexing` (after a bind, after `retry-indexing`) reads ' +
        'that file instead of walking the whole listing. Answers an `ETag` ' +
        'and 304 like every JSON read, so an `If-None-Match` poll costs ' +
        'no body while nothing has changed. Requires read access to the ' +
        'project. A file of another project or organization, a document ' +
        'without a file, and a trashed or absent one answer the same opaque ' +
        '404 `FILE_NOT_FOUND`. Project files never appear in ' +
        '`GET /api/v1/documents/{id}` — that is the knowledge hub’s surface.',
      operationId: 'getProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'The file’s document id'),
      ],
      responses: {
        '200': jsonResponse('The file', {
          type: 'object',
          required: ['file'],
          properties: { file: ref('ProjectFile') },
        }),
        '404': errorResponse(
          'Project not found (`PROJECT_NOT_FOUND`), or the file is not a live file of this project (`FILE_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
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
        '`Range` is honoured (206, or a bodiless 416 for a range the file ' +
        'cannot satisfy — judged against the stored size before any byte ' +
        'is fetched) and a HEAD request answers the headers alone — ' +
        '`Content-Length`, `ETag`, `Last-Modified`, `Accept-Ranges` — ' +
        'ignoring `Range`. Visibility is the ' +
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
        ...fileConditionalParams,
        {
          name: 'Range',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'A single byte range (`bytes=0-1023`, `bytes=1024-`, ' +
            '`bytes=-512`): 206 with `Content-Range`, or a bodiless 416 for ' +
            'a range starting at or past the end of the file. Several ' +
            'ranges, another unit or a spec that does not parse are ignored ' +
            'and the whole file answers 200; a HEAD ignores it.',
        },
        {
          name: 'If-Range',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'With `Range`, the `ETag` the partial download started from: ' +
            'the range is served only while the file is still that ' +
            'representation, otherwise the whole file answers 200.',
        },
      ],
      responses: {
        '200': {
          description: 'The file bytes, named by `Content-Disposition`',
          headers: {
            'Content-Disposition': headerRef('ContentDisposition'),
            'Content-Length': headerRef('ContentLength'),
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Accept-Ranges': headerRef('AcceptRanges'),
          },
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '206': {
          description:
            'The bytes of a satisfied `Range`; `Content-Range` names the ' +
            'slice and the file’s size. Ranges are clamped to the file ' +
            '(`bytes=0-99999999` on a shorter file answers what exists); a ' +
            '`Range` the server cannot read (`bytes=abc`, several ranges) ' +
            'is ignored and the whole file answers 200',
          headers: {
            'Content-Range': headerRef('ContentRange'),
            'Content-Disposition': headerRef('ContentDisposition'),
            'Content-Length': headerRef('ContentLength'),
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Accept-Ranges': headerRef('AcceptRanges'),
          },
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        '416': {
          description:
            'The range starts at or past the end of the file (`bytes=<size>-` ' +
            '— what a resumed download sends once its copy is complete): an ' +
            'empty body (`Content-Length: 0`), no envelope, `Content-Range: ' +
            'bytes */<size>` naming the size, no byte fetched from the store',
          headers: {
            'Content-Range': headerRef('ContentRange'),
            'Accept-Ranges': headerRef('AcceptRanges'),
            'Content-Length': headerRef('ContentLength'),
          },
        },
        '304': fileNotModified,
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

  paths['/api/v1/projects/{id}/files/{documentId}/retry-indexing'] = {
    post: {
      tags: ['Projects'],
      summary: 'Index a project file now',
      description:
        'The REST twin of **Index now** on the project’s Knowledge tab: ' +
        're-queues the file’s blob for indexing through the core behind ' +
        '`POST /api/v1/documents/{id}/retry-indexing` (which answers 404 ' +
        'for a project file) and answers the same `{status, reason}`. A ' +
        'file bound with the default `skipRagIndexing: true` is opted back ' +
        'in by this request — the explicit ask is the opt-in — and answers ' +
        '`indexing`; poll its `indexing` on `GET /api/v1/projects/{id}/files/{documentId}` ' +
        '(304 while unchanged) until `completed`, from when `POST …/knowledge/search` finds it, ' +
        'or `unsupported` — terminal, `indexing.errorCode` says why. ' +
        '`skipped` names its `reason`: a blob the platform does not track ' +
        '(`untracked-blob`), a file type no extractor can read ' +
        '(`unsupported` — terminal; the row’s `indexing.error` says why), ' +
        'or a fresh index job already queued or running (`in-progress` — ' +
        'poll instead); `content-only` cannot occur here, a project file ' +
        'always has a blob. Requires the org editor role and project edit ' +
        'access on an active project — the gate `DELETE …/files/{documentId}` ' +
        'runs — plus a role that can write documents (403 `RBAC_FORBIDDEN`); ' +
        'the same budget as the Hub door, 10 retries per user per minute, ' +
        'answers 429 `RATE_LIMITED` with `Retry-After`. A file of another ' +
        'project or organization, a document without a file, and a trashed ' +
        'or absent one answer the same opaque 404 (`FILE_NOT_FOUND`).',
      operationId: 'retryProjectFileIndexing',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '200': jsonResponse(
          'Whether indexing was queued',
          ref('RetryIndexingResult'),
        ),
        '403': errorResponse(
          'No write access to an active project, or a role that cannot ' +
            'write documents (`RBAC_FORBIDDEN`)',
        ),
        '404': errorResponse('Project or file not found (`FILE_NOT_FOUND`)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/files'] = {
    get: {
      tags: ['Projects'],
      summary: 'List the project’s files',
      description:
        'Keyset-paginated (`cursor` + `limit`, answering `{files, isDone, ' +
        'continueCursor}` — pass `continueCursor` back as `cursor` until ' +
        '`isDone`; while more pages remain the answer also carries `cursor`, ' +
        'the same token under its pre-1.5.0 name — deprecated, served for at ' +
        'least two more minor versions). ' +
        '`folderId` narrows to one folder of this project. Project files ' +
        'never appear in `GET /api/v1/documents` — that is the knowledge ' +
        'hub’s surface. Newest first — ordered by `createdAt`, then `id`, ' +
        'both descending; the cursor is that pair, so a file bound while ' +
        'you page lands ahead of the cursor and is not served by that ' +
        'pass, and a deleted file simply drops out.',
      operationId: 'listProjectFiles',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        queryParam(
          'folderId',
          'Only files inside this project folder — a folder id of this ' +
            'project (any other id is 404 `FOLDER_NOT_FOUND`), or `root` ' +
            'for the files in no folder. Omit it to list every file of ' +
            'the project.',
        ),
        ...paginationParams(100, 25),
      ],
      responses: {
        '200': jsonResponse('The files', {
          type: 'object',
          [PAGINATION]: 'keyset',
          required: ['files', 'isDone', 'continueCursor'],
          properties: {
            files: { type: 'array', items: ref('ProjectFile') },
            isDone: {
              type: 'boolean',
              description: 'True when no more pages remain',
            },
            continueCursor: {
              type: 'string',
              description:
                'Pass back as `cursor` for the next page; empty when `isDone`',
            },
            cursor: {
              type: 'string',
              deprecated: true,
              description:
                'The same token as `continueCursor`, present only while ' +
                'more pages remain — the pre-1.5.0 spelling, served for at ' +
                'least two more minor versions; read `continueCursor`',
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
        'extension, which the name must carry; a declared `contentType` ' +
        'is a hint resolved against it, never a substitute), and the ' +
        'organization’s `file:upload` budget answers 429. `fileName` must ' +
        'be a file name — no path separators, no `..`, no control ' +
        'characters — and is stored trimmed and NFC-normalized, the rule ' +
        'a folder name follows. A refusal rolls the ' +
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
              required: [
                'id',
                'fileName',
                'folderId',
                'projectId',
                'size',
                'mimeType',
              ],
              properties: {
                id: { type: 'string' },
                fileName: { type: 'string' },
                folderId: { type: 'string' },
                projectId: { type: 'string' },
                size: {
                  ...int,
                  description:
                    'The landed bytes — the authoritative size the upload ' +
                    'policy judged',
                },
                mimeType: {
                  ...str,
                  description:
                    'The type the gate resolved from the file name (a ' +
                    'declared `contentType` is a hint), as the row was written',
                },
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
        'name an automation that exists (404 `AUTOMATION_NOT_FOUND`), has a deployed ' +
        'version (409 `AUTOMATION_NOT_DEPLOYED`) and applies to this project (403 ' +
        '`AUTOMATION_PROJECT_FORBIDDEN`); it fills an empty assignee ' +
        'without replacing an existing one. `runWorkflowSlug` starts only a freshly created ' +
        'task; poll its `runId` at `GET /api/v1/projects/{id}/runs/{runId}` (`executionId` ' +
        'carries the same value and is deprecated). An undeployed ' +
        'workflow or a start failure after the task committed returns `runId` null. ' +
        'An idempotent repeat omits `runId` and does not re-validate `runWorkflowSlug` ' +
        '(a stable retry payload reconciles the task as documented). Supplying runWorkflowSlug charges the ' +
        'execute bucket before intake, in addition to the general REST bucket. Scope ' +
        'selectors such as projectId are refused in the body. `setupFolderName` binds ' +
        'the task to a root folder of the project by name (matched without regard to ' +
        'case): that folder’s id is stored as the task’s `externalUrl` — the ' +
        'Setup-folder binding a folder-driven automation reads off its task input — ' +
        'on the create and again on every repeat. It cannot be sent beside ' +
        '`externalUrl` (400 `INVALID_BODY`), and a name no root folder of the project ' +
        'carries is refused (400 `SETUP_FOLDER_MISSING`), nothing created.',
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
              'when missing); trimmed and NFC-normalized, never blank, ' +
              'matched without regard to case — the catalog keeps the ' +
              'spelling a label was first created with, and two names ' +
              'differing only in case are one label. Read back as stored, ' +
              'in the order sent.',
          },
          externalUrl: {
            type: 'string',
            format: 'uri',
            maxLength: 2048,
            description:
              'An absolute http(s) URL to the source item, rendered as a ' +
              'link; any other scheme is refused. Changes only when supplied. ' +
              'Not beside `setupFolderName`, which fills the same field with ' +
              'a folder id.',
          },
          setupFolderName: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description:
              'The name of a root folder of this project (trimmed, matched ' +
              'without regard to case) whose id is stored as the task’s ' +
              '`externalUrl` — the Setup-folder binding a folder-driven ' +
              'automation reads off its task input, resolved on every ' +
              'intake. Refused beside `externalUrl` (400 `INVALID_BODY`); a ' +
              'name no root folder carries is 400 `SETUP_FOLDER_MISSING`, ' +
              'nothing created.',
          },
          externalState: {
            type: 'string',
            enum: ['open', 'closed'],
            description:
              'The source item’s lifecycle (default `open`). `closed` parks ' +
              'the task at `in_review` for a person to complete — only the ' +
              'workflow engine itself lands a close at `done`. `open` ' +
              'reopens a task the mirror closed — one it parked at ' +
              '`in_review`, or a `done` one — back to `backlog`. A park a ' +
              'person or an agent made is theirs: `open` leaves it, and any ' +
              'move through the board ends the mirror’s claim on a park it ' +
              'made. Local triage owns every other status; a cancelled ' +
              'task stays cancelled.',
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
          'Project is read-only or archived, or the automation is bound to other projects (`AUTOMATION_PROJECT_FORBIDDEN`)',
        ),
        '404': errorResponse(
          'Project missing or invisible (`PROJECT_NOT_FOUND`), or `automationSlug` names an automation nobody saved (`AUTOMATION_NOT_FOUND`)',
        ),
        '409': errorResponse(
          '`automationSlug` names an automation with no deployed version (`AUTOMATION_NOT_DEPLOYED`) — deploy it, then assign',
        ),
        ...standardErrors,
        // Richer than the standard 400: the Setup-folder binding's own
        // refusal lands here too, with its code.
        '400': errorResponse(
          'Malformed body (`INVALID_BODY` — `setupFolderName` beside `externalUrl` included), or `setupFolderName` names no root folder of this project (`SETUP_FOLDER_MISSING`)',
        ),
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
    patch: {
      tags: ['Tasks'],
      summary: 'Archive or restore a project task',
      description:
        'The task’s lifecycle toggle — the one verb the board had and this door did not. `archived: true` archives the task: it stays readable through this door and refuses comments and starts with 403 `TASK_ARCHIVED`; `false` restores it. Both are idempotent — a task already in the requested state is left unchanged — so a mirror that supersedes a task (a re-delivery that opened a new one, a cancelled source record) can retire the old one without reading it first. Requires write access to an ACTIVE project (403 `PROJECT_ARCHIVED` / `RBAC_FORBIDDEN` otherwise); the task itself may be archived, which is what the restore is for. The task must belong to the URL project (404 `TASK_NOT_FOUND`). Answers the task as it now stands.',
      operationId: 'setTaskArchived',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['archived'],
        properties: {
          archived: {
            type: 'boolean',
            description: '`true` archives the task, `false` restores it',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The task as it now stands', {
          type: 'object',
          required: ['task'],
          properties: { task: ref('Task') },
        }),
        '403': errorResponse(
          'Project is read-only for the key holder (`RBAC_FORBIDDEN`) or archived (`PROJECT_ARCHIVED`)',
        ),
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
          [PAGINATION]: 'keyset',
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
                  bodyByLocale: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                    description:
                      'Equivalent localized bodies when supplied by the workflow. Select the reader’s exact locale, then base language, then en, then body. Absent for comments without translations.',
                  },
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
        'Any member who can read the project may comment; an editor seat is not required. The task must belong to the URL project, and both the project and the task must be active — an archived task refuses the comment (403 `TASK_ARCHIVED`) the way an archived project does (`PROJECT_ARCHIVED`). `body` is trimmed; whitespace alone is a missing body. Optional bodyByLocale carries equivalent translations for the reader’s UI language. Comments use the key holder as author and share the app’s per-user task:comment budget and mention behavior. A later plain-text edit clears the old translations.',
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
          bodyByLocale: {
            type: 'object',
            maxProperties: 16,
            required: ['en', 'de', 'fr'],
            additionalProperties: {
              type: 'string',
              minLength: 1,
              maxLength: 10000,
            },
            properties: {
              en: { type: 'string', minLength: 1, maxLength: 10000 },
              de: { type: 'string', minLength: 1, maxLength: 10000 },
              fr: { type: 'string', minLength: 1, maxLength: 10000 },
            },
            description:
              'Equivalent trimmed translations; en/de/fr required. At most 16 locale keys matching ^[a-z]{2}(-[A-Z]{2})?$ are allowed. Each value has the same 10,000-character limit as body.',
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
        'Requires write access to an active project and an active task belonging to it (an archived task answers 403 `TASK_ARCHIVED`). Runs the deployed workflow with this task as its input, attributed to the URL project and api-key:<userId>. `workflowSlug` must name an automation that exists — 404 `AUTOMATION_NOT_FOUND` otherwise — with a deployed version: one saved but not deployed answers 409 `AUTOMATION_NOT_DEPLOYED`, naming it (the two refusals `POST …/tasks` gives an `automationSlug`), judged before the execute budget is charged. An organization automation can operate in the project; a project-bound automation must include this project (403 `AUTOMATION_PROJECT_FORBIDDEN` otherwise). A task carries at most one live run, whichever automation started it: a start while one is live reuses it. Once the door reaches the start the answer is 200 — branch on `started`, never on the status alone: `reason: "already_running"` carries the in-flight run — read its `name` at GET /api/v1/projects/{id}/runs/{runId} to learn which automation holds the task — and `reason: "not_started"` with a null `runId` is the residual case of a deployment withdrawn between the check and the start; other refusals return their error status. Poll `runId` at `GET /api/v1/projects/{id}/runs/{runId}` (`executionId` carries the same value and is deprecated). Charges the execute bucket on top of the general REST bucket.',
      operationId: 'startTaskWorkflow',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['workflowSlug'],
        properties: {
          workflowSlug: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'The automation’s name as GET /api/v1/automations lists it — the `/` form (`billing/dunning`), never the `__` spelling the `{name}` path parameter takes',
          },
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
            '(`TASK_ARCHIVED`), or the automation is bound to other projects (`AUTOMATION_PROJECT_FORBIDDEN`)',
        ),
        '404': errorResponse(
          'The project is missing or invisible (`PROJECT_NOT_FOUND`), the ' +
            'task is missing or belongs to another project ' +
            '(`TASK_NOT_FOUND`), or `workflowSlug` names an automation ' +
            'nobody saved (`AUTOMATION_NOT_FOUND`)',
        ),
        '409': errorResponse(
          '`workflowSlug` names an automation that is saved but has no ' +
            'deployed version (`AUTOMATION_NOT_DEPLOYED`) — deploy it, then ' +
            'start again',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/tasks/{taskId}/review'] = {
    get: {
      tags: ['Tasks'],
      summary: 'Read a task’s open review',
      description:
        'The task’s status beside the review a person still has to decide — `review: null` when none is pending. Read access, like the task itself. A task reaches `in_review` when its workflow parks there; the decision is made with a POST to this path, or on the board.',
      operationId: 'getTaskReview',
      security: sec,
      parameters: taskParameters,
      responses: {
        '200': jsonResponse('The task’s status and its pending review', {
          type: 'object',
          required: ['task', 'review'],
          properties: {
            task: {
              type: 'object',
              required: ['id', 'status'],
              properties: {
                id: str,
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
              },
            },
            review: nullable(ref('TaskReview')),
          },
        }),
        '404': taskNotFound,
        ...standardErrors,
      },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Decide a task’s review for a member',
      description:
        'Requires write access to an active project and a task in `in_review` (409 `TASK_NOT_IN_REVIEW` otherwise). The decision is a person’s own gesture relayed from another application, so `actor` is required and the caller needs `capabilities.actAs` from `/me` (403 `ROLE_FORBIDDEN` without it); the member is resolved by verified e-mail (see `Actor`) and it is THEIR project access and the organization’s `review_policy` that decide, exactly as on the board — 403 `REVIEW_INDEPENDENT_REVIEWER_REQUIRED` or `REVIEW_COMPETENCE_REQUIRED` when the policy refuses them. `approve` is the move to Done: the pending review is recorded as approved by the member and audited, and the task’s status becomes `done` (a task with open subtasks answers 409 `TASK_HAS_OPEN_SUBTASKS`). `request_changes` withdraws the review, puts the member’s `comment` on the timeline and starts `workflowSlug` again on the task — the workflow reads the comment as operator feedback — so both fields are required for it; the task’s status becomes `in_progress` and the answer carries the run to poll (`started: false` with `reason` semantics as on `…/start`: a live run is reused). Charges the execute bucket on top of the general REST bucket.',
      operationId: 'decideTaskReview',
      security: sec,
      parameters: taskParameters,
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['decision', 'actor'],
        properties: {
          decision: { type: 'string', enum: ['approve', 'request_changes'] },
          comment: {
            type: 'string',
            minLength: 1,
            maxLength: 20000,
            description:
              'The member’s feedback — required for `request_changes`, ignored for `approve`',
          },
          workflowSlug: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'The automation to start again with the feedback — required for `request_changes`; the `/` form (`billing/dunning`), as on `…/start`',
          },
          actor: ref('Actor'),
        },
      }),
      responses: {
        '200': jsonResponse('The decision was applied', {
          type: 'object',
          required: ['task', 'decision', 'approvalId', 'actorUserId'],
          properties: {
            task: {
              type: 'object',
              required: ['id', 'status'],
              properties: {
                id: str,
                status: { type: 'string', enum: ['done', 'in_progress'] },
              },
            },
            decision: {
              type: 'string',
              enum: ['approve', 'request_changes'],
            },
            approvalId: {
              type: 'string',
              nullable: true,
              description:
                'The review the decision closed, or null when the task was in review without a recorded review row',
            },
            actorUserId: {
              type: 'string',
              description:
                'The member the e-mail resolved to — pin it as `actor.userId` on later calls',
            },
            started: {
              type: 'boolean',
              description:
                'Present for `request_changes`: true when THIS call started the run, false when a live run was reused',
            },
            runId: {
              type: 'string',
              nullable: true,
              description:
                'Present for `request_changes`: the run to poll at GET /api/v1/projects/{id}/runs/{runId}',
            },
            executionId: {
              type: 'string',
              nullable: true,
              deprecated: true,
              description: 'Alias of `runId`',
            },
          },
        }),
        '403': errorResponse(
          'Project is read-only or archived, the task is archived (`TASK_ARCHIVED`), an `actor` sent without `capabilities.actAs` (`ROLE_FORBIDDEN`), an actor whose e-mail is unverified (`ACTOR_UNVERIFIED`), whose membership is disabled (`ACTOR_DISABLED`) or who may not write this task (`ACTOR_FORBIDDEN`), or a member the review policy refuses (`REVIEW_INDEPENDENT_REVIEWER_REQUIRED`, `REVIEW_COMPETENCE_REQUIRED`)',
        ),
        '404': errorResponse(
          'The project is missing or invisible (`PROJECT_NOT_FOUND`), the task is missing or outside this project (`TASK_NOT_FOUND`), no member carries the actor’s e-mail (`ACTOR_NOT_FOUND`), or `workflowSlug` names an automation nobody saved (`AUTOMATION_NOT_FOUND`)',
        ),
        '409': errorResponse(
          'The task is not in review (`TASK_NOT_IN_REVIEW`); it has open subtasks (`TASK_HAS_OPEN_SUBTASKS`); two members carry the actor’s e-mail (`ACTOR_AMBIGUOUS`); the e-mail now belongs to another member than the pinned `userId` (`ACTOR_REBOUND`); `workflowSlug` is saved but not deployed (`AUTOMATION_NOT_DEPLOYED`)',
        ),
        ...standardErrors,
        '400': withDoorRefusal(
          standardErrors['400'],
          'a `request_changes` without `comment` or `workflowSlug` (`INVALID_BODY`, the field named under `data.issues`)',
        ),
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
        'other value answers 400 `INVALID_QUERY`. An inlining page reads ' +
        'at most 25 rows (`limit` is clamped) and answers at most 8 MiB of ' +
        'them: it ends at the last row that fits — possibly before `limit`, ' +
        'never before one row — with `isDone: false` and a `continueCursor` ' +
        'at that row, so keep following the cursor until `isDone`',
    ),
  ];
  /** The `{runs, isDone, continueCursor}` page every run listing answers. */
  const runsPage: Json = {
    type: 'object',
    [PAGINATION]: 'keyset',
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
  /** The header that makes a 202-then-poll operation safe to retry — one
   * factory for every door that honours it (a run start, a chat send), the
   * subject words differing. */
  const idempotencyKeyParam = (subject: {
    /** What the key names: `start`, `send`. */
    names: string;
    /** What besides the key the repeat must match: `automation and scope`. */
    scope: string;
    /** What the repeat answers: the run, the accepted send. */
    answer: string;
  }) => ({
    name: 'Idempotency-Key',
    in: 'header' as const,
    required: false,
    schema: {
      type: 'string',
      pattern: '^[ -~]*[!-~][ -~]*$',
      maxLength: 255,
    },
    description:
      `A stable key of your choosing that names this ${subject.names} — ` +
      'printable ASCII (a UUID, a job id), at most 255 characters: any ' +
      'other character answers 400 `INVALID_HEADER`, naming the header ' +
      `under \`data.issues\`, and no ${subject.names} happens — keys are ` +
      'compared byte for byte once surrounding whitespace is removed, so ' +
      'the pattern is what keeps two spellings of one key from naming two ' +
      `${subject.names}s; a header value carrying a control character ` +
      'never reaches the platform, the edge refuses the request before ' +
      'any envelope. A ' +
      `repeat with the same key, ${subject.scope} within 24 hours answers ` +
      `202 with ${subject.answer} and \`duplicate: true\`; a repeat with a ` +
      'different body answers 409 `IDEMPOTENCY_KEY_REUSED`. A refused ' +
      `${subject.names} is not remembered, so the same key runs once the ` +
      'refusal is fixed. A header sent but left blank (spaces only), or ' +
      'one over 255 characters, answers 400 `INVALID_HEADER` and starts ' +
      'nothing — omit the header to proceed without a key; it is never ' +
      'silently read as "no key".',
  });
  const runIdempotencyKeyParam = idempotencyKeyParam({
    names: 'start',
    scope: 'automation and scope',
    answer: 'the run the first attempt started',
  });
  const sendIdempotencyKeyParam = idempotencyKeyParam({
    names: 'send',
    scope: 'thread and scope',
    answer:
      'what the first attempt answered — the same `messageId` to poll for, nothing new queued',
  });

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
        'installations. Run history is kept — listed by `GET /api/v1/runs`, ' +
        'readable by id, and still answered by name at ' +
        '`GET /api/v1/automations/{name}/runs` (the project twin included). ' +
        'Requires the developer capability. A run still in flight refuses ' +
        'the delete — cancel or wait for it first.',
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
        'ids of the projects it is installed in that the key holder can see ' +
        '— a complete set, not paginated. Requires project read access. ' +
        'Organization-wide definitions are available from the global catalog.',
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
              ? 'Project missing or invisible (`PROJECT_NOT_FOUND`), or a name no saved automation and no run of the organization bears (`AUTOMATION_NOT_FOUND`) — a deleted automation’s kept runs still answer'
              : 'A name no saved automation and no run of the organization bears (`AUTOMATION_NOT_FOUND`) — a deleted automation’s kept runs still answer',
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
              ? 'Project missing or invisible (`PROJECT_NOT_FOUND`), automation not found (`AUTOMATION_NOT_FOUND`), or the named `version` was never saved (`AUTOMATION_VERSION_UNKNOWN`)'
              : 'Automation not found (`AUTOMATION_NOT_FOUND`), or the named `version` was never saved (`AUTOMATION_VERSION_UNKNOWN`)',
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
        'Requires the developer capability. One trigger per automation: the ' +
        'PUT replaces whatever was bound, and binding another kind over a ' +
        'live webhook revokes its URL — the response says so (`revoked`). ' +
        'For a webhook trigger the plaintext token is returned ONCE in this ' +
        'response (and again only with `rotateToken: true`); the platform ' +
        'stores a hash. Each kind takes its own keys — `cron` and `timezone` ' +
        'only with `schedule`, `event` only with `event`, `rotateToken` only ' +
        'with `webhook`, `enabled` with any — and a key of another kind is ' +
        'refused like an unknown key (`INVALID_BODY`, named under ' +
        '`data.issues`). The 200 says whether the automation has a version ' +
        'to run (`deployed`): binding before deploying is accepted, and such ' +
        'a trigger skips every occurrence as `not_deployed` — visible on ' +
        '`GET /api/v1/automations` — until a version is deployed.',
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
            description:
              'Only with `kind: schedule`: the five-field cron expression. ' +
              'One that can never fire — a field out of range, a day no ' +
              'named month has (`0 0 30 2 *`) — answers 400 ' +
              '`AUTOMATION_TRIGGER_INVALID`.',
          },
          timezone: {
            type: 'string',
            description:
              'Only with `kind: schedule`: the IANA zone the cron is read ' +
              'in (UTC when absent)',
          },
          event: {
            type: 'string',
            enum: [...EMITTED_EVENT_TYPES],
            description:
              'Only with `kind: event`: the platform event that starts the ' +
              'automation — one of the events the platform raises. Any other ' +
              'name answers 400 `AUTOMATION_TRIGGER_INVALID`, naming this list.',
          },
          enabled: { type: 'boolean', default: true },
          rotateToken: {
            type: 'boolean',
            description:
              'Only with `kind: webhook`: mint (and return) a fresh token',
          },
        },
      }),
      responses: {
        '200': jsonResponse('Trigger bound', {
          type: 'object',
          required: ['name', 'deployed'],
          properties: {
            name: { type: 'string' },
            deployed: {
              ...bool,
              description:
                'Whether the automation has a deployed version. False means ' +
                'the binding is live but starts nothing — every occurrence ' +
                'is skipped as `not_deployed` — until one is deployed.',
            },
            token: {
              type: 'string',
              description: 'Webhook trigger only, shown once',
            },
            revoked: {
              type: 'string',
              enum: ['webhook'],
              description:
                'Present when this bind replaced a live webhook trigger ' +
                'with another kind: its URL stopped answering the moment ' +
                'the bind committed, and no later bind brings that token ' +
                'back. Absent on a first bind and on a re-bind of the same ' +
                'kind (which keeps the token).',
            },
          },
        }),
        '403': errorResponse('Needs the developer capability'),
        '404': errorResponse('Automation not found'),
        ...standardErrors,
        '400': errorResponse(
          'Invalid body (`INVALID_BODY` — an unknown key, a key that belongs to another kind, each named under `data.issues`), or a trigger that could never fire: a cron that matches nothing (including a day no named month has, `0 0 30 2 *`), a time zone that is not an IANA zone, an event the platform does not raise (`AUTOMATION_TRIGGER_INVALID`)',
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
        description: `${visibility} A poller after the outcome should name the keys it reads — \`?fields=status,finishedAt\` — instead of moving the input, the trace and the checkpoints on every read; the answer then carries exactly those keys.`,
        operationId: scope.project ? 'getProjectRun' : 'getRun',
        security: sec,
        parameters: [
          ...parameters,
          queryParam(
            'fields',
            'The keys of `Run` to answer, comma-separated (`status,finishedAt`); ' +
              'absent, the whole run. A name that is not a key of `Run` ' +
              'answers 400 `INVALID_QUERY`',
          ),
        ],
        responses: {
          '200': jsonResponse(
            'Status, output, trace, effects and checkpoints — or, with `fields`, only the keys it named',
            { anyOf: [ref('Run'), ref('RunProjection')] },
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
    paths[`${scope.path}/ask`] = {
      get: {
        tags: ['Runs'],
        summary: 'Read the question a run is waiting on',
        description: `${visibility} The live question of the run — what \`waitingFor: "ask"\` parks it on — or \`ask: null\` when nothing waits on a person: a run that is not waiting, an expired question, a finished run. Same visibility as reading the run; no developer capability. Answer it at \`POST …/asks/{askId}\`.`,
        operationId: scope.project ? 'getProjectRunAsk' : 'getRunAsk',
        security: sec,
        parameters,
        responses: {
          '200': jsonResponse('The pending question, or null', {
            type: 'object',
            required: ['ask'],
            properties: { ask: nullable(ref('PendingAsk')) },
          }),
          '404': errorResponse('Run missing or outside the visible URL scope'),
          ...standardErrors,
        },
      },
    };
    paths[`${scope.path}/asks/{askId}`] = {
      post: {
        tags: ['Runs'],
        summary: 'Answer the question a run is waiting on',
        description: `${visibility}${scope.project ? ' Requires write access to an active project.' : ' Requires membership.'} Records the answer and resumes the run in the same transaction, then mirrors the answer onto the task timeline as the answerer’s own comment when the run works on a task. The agent asked a person, so the record names one: send \`actor\` to answer FOR a verified member (the caller then needs \`capabilities.actAs\` from \`/me\` — 403 \`ROLE_FORBIDDEN\` without it; the member is resolved by e-mail, see \`Actor\`), or send none to answer as the key (\`answeredBy: "api-key:<userId>"\`). A question already answered or closed answers 409 \`HUMAN_ASK_NOT_PENDING\`, one past its deadline 409 \`HUMAN_ASK_EXPIRED\` (the run then fails with \`failureCode: "ask_expired"\`), one this run did not ask 404 \`HUMAN_ASK_NOT_FOUND\`. Charges the execute bucket on top of the general REST bucket.`,
        operationId: scope.project ? 'answerProjectRunAsk' : 'answerRunAsk',
        security: sec,
        parameters: [
          ...parameters,
          pathParam('askId', 'The question’s `askId`, as `GET …/ask` named it'),
        ],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['answer'],
          properties: {
            answer: {
              type: 'string',
              minLength: 1,
              maxLength: 20000,
              description:
                'The answer as the agent reads it. For a `questions` set, one line per question in the form the app sends: `<question> → <picked label>; <typed text> (in their own words)`',
            },
            actor: ref('Actor'),
          },
        }),
        responses: {
          '200': jsonResponse('The answer was recorded and the run resumes', {
            type: 'object',
            required: ['ok', 'askId', 'runId', 'answeredBy', 'taskId'],
            properties: {
              ok: { type: 'boolean', enum: [true] },
              askId: str,
              runId: str,
              answeredBy: {
                type: 'string',
                description:
                  'What `answered_by` records: the actor’s user id, or `api-key:<userId>` when the key answered as itself',
              },
              actorUserId: {
                type: 'string',
                description:
                  'Present when `actor` was sent: the member the e-mail resolved to — pin it as `actor.userId` on later calls so a reassigned address refuses instead of acting as its new holder',
              },
              taskId: {
                type: 'string',
                nullable: true,
                description:
                  'The task the run works on, whose timeline carries the answer as a comment; null for a run without a task',
              },
            },
          }),
          '403': errorResponse(
            scope.project
              ? 'Project is read-only or archived; an `actor` sent without `capabilities.actAs` (`ROLE_FORBIDDEN`); an actor whose e-mail is unverified (`ACTOR_UNVERIFIED`), whose membership is disabled (`ACTOR_DISABLED`) or who may not see this project (`ACTOR_FORBIDDEN`)'
              : 'An `actor` sent without `capabilities.actAs` (`ROLE_FORBIDDEN`); an actor whose e-mail is unverified (`ACTOR_UNVERIFIED`), whose membership is disabled (`ACTOR_DISABLED`) or who may not see this project (`ACTOR_FORBIDDEN`)',
          ),
          '404': errorResponse(
            'Run missing or outside the visible URL scope (`RUN_NOT_FOUND`); the question is not this run’s (`HUMAN_ASK_NOT_FOUND`); no member carries the actor’s e-mail (`ACTOR_NOT_FOUND`)',
          ),
          '409': errorResponse(
            'The question was already answered or closed (`HUMAN_ASK_NOT_PENDING`) or expired (`HUMAN_ASK_EXPIRED`); two members carry the actor’s e-mail (`ACTOR_AMBIGUOUS`); the e-mail now belongs to another member than the pinned `userId` (`ACTOR_REBOUND`)',
          ),
          ...standardErrors,
          '400': withDoorRefusal(
            standardErrors['400'],
            'an answer that is blank once trimmed (`EMPTY_ANSWER`)',
          ),
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
            properties: {
              cancelled: {
                ...bool,
                description:
                  'True when THIS call stopped a live run; false when there was nothing live to stop.',
              },
              status: {
                type: 'string',
                enum: ['success', 'failed', 'cancelled'],
                description:
                  'The run’s state after the call: `cancelled` when this call stopped it; with `cancelled: false`, the terminal state that made the cancel a no-op — `success`, `failed`, or `cancelled` by an earlier call — so a client needs no second read to learn why (2026-09-14 evaluation, g5-8). A cancelled run’s `detail` is null.',
              },
            },
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
        'The configured chat models available to the key holder in this organization, filtered by model-access policy and direct API credentials. Subscription models that require a sandbox are excluded. An empty list means none are available; the list is a complete set, not paginated. Use id as model when sending a message, and providerSlug when the same id is listed under more than one provider. Each entry carries what a client needs to choose — context window, output cap, capabilities, price when the catalog publishes one, tags — and `default: true` marks the organization’s default pick for this key holder. The list is the organization’s configured catalog, not a promise from the provider’s account: a plan that excludes a listed model fails the turn with errorCode `model_not_entitled`, a spent balance with `credit_exhausted`.',
      operationId: 'listChatModels',
      security: sec,
      responses: {
        '200': jsonResponse(
          'Available models',
          listOf('models', ref('ChatModel'), {
            harnesses: {
              type: 'array',
              description:
                'The harnesses a project agent may run on — the managed lane’s, those that run unattended on the platform’s own credentials; `harness` is the value `POST /api/v1/projects/{id}/agents` takes, and a value outside this list answers 400 `PROJECT_AGENT_HARNESS_INVALID` naming the list in `data.harnesses`',
              items: {
                type: 'object',
                required: ['harness', 'label'],
                properties: {
                  harness: {
                    ...str,
                    description: 'The slug the agent input takes',
                  },
                  label: { ...str, description: 'The harness’s display name' },
                },
              },
            },
          }),
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
        description: `A direct chat with the built-in assistant. ${scope.project ? 'The URL supplies its project context. Any member with project read access may create a chat while the project is active.' : 'The thread has no project context.'} This operation accepts only an optional title (trimmed, 1–120 characters — the bound \`PATCH\` renames within); agent selectors and projectId are refused. Project agents execute through project tasks. A thread created without a title is named by the assistant after its first message (read \`title\` back from the thread); \`PATCH\` renames it.`,
        operationId: scope.project ? 'createProjectThread' : 'createThread',
        security: sec,
        parameters: collectionParameters,
        requestBody: jsonBody(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 120,
                description:
                  'The thread’s name, trimmed (1–120 characters) — the same bound PATCH renames within',
              },
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
        description: `${visibility} Archiving is the app’s own toggle, audited the same way: an archived thread stays readable and refuses messages with 409 \`CHAT_THREAD_ARCHIVED\`; \`archived: false\` restores it. A thread whose turn is still running — or whose accepted send is still queued — refuses the archive with 409 \`CHAT_TURN_IN_PROGRESS\`, as the delete does: cancel the turn first (restoring and renaming stay open mid-turn). Archiving stamps \`archivedAt\` and leaves \`updatedAt\` — the last message activity — untouched. \`title\` renames the thread (trimmed, 1–120 characters). Send at least one of the two.`,
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
          '409': errorResponse(
            '`archived: true` while a turn is running on the thread, or an accepted send is still queued (`CHAT_TURN_IN_PROGRESS`)',
          ),
          ...standardErrors,
        },
      },
      delete: {
        tags: ['Threads'],
        summary: 'Delete a thread',
        description: `${visibility} Moves the thread to the app’s trash (its grace window and legal-hold check apply). A thread whose turn is still running — or whose accepted send is still queued — answers 409 \`CHAT_TURN_IN_PROGRESS\`; cancel the turn first.`,
        operationId: scope.project ? 'deleteProjectThread' : 'deleteThread',
        security: sec,
        parameters: itemParameters,
        responses: {
          '204': noContent('Deleted'),
          ...archivedProject,
          '404': notFound,
          '409': errorResponse(
            'A turn is running on the thread, or an accepted send is still queued (`CHAT_TURN_IN_PROGRESS`)',
          ),
          ...standardErrors,
        },
      },
    };
    paths[`${scope.item}/messages`] = {
      get: {
        tags: ['Threads'],
        summary: 'Read a thread’s messages',
        description: `${visibility} Messages are in sequence order — oldest first, or newest first with \`order=desc\`, so the reply a turn just produced is on the first page of a long thread; use the previous continueCursor as cursor for the next page (a cursor is bound to the direction it was minted in). While a turn runs, its assistant row is already on the page with status \`pending\` and empty parts — the row GET ${scope.item}/generation names as messageId — and is filled in when the turn settles; the page is complete without that row being final. One message is also readable by id at GET ${scope.item}/messages/{messageId}.`,
        operationId: scope.project
          ? 'listProjectThreadMessages'
          : 'listMessages',
        security: sec,
        parameters: [
          ...itemParameters,
          ...paginationParams(100, 25),
          {
            ...queryParam(
              'order',
              'The walk’s direction: `asc` (the default) pages oldest first from sequence 0, `desc` pages newest first — the settled reply of the latest turn leads the first page. A `cursor` minted walking one direction is refused with 400 `INVALID_CURSOR` on the other',
            ),
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          },
        ],
        responses: {
          '200': jsonResponse('Paginated messages', pageOf(ref('Message'))),
          '404': notFound,
          ...standardErrors,
        },
      },

      post: {
        tags: ['Threads'],
        summary: 'Send a message and start a turn',
        description: `${visibility} ${scope.project ? 'The project must be active; members can send without an editor seat. ' : ''}Answers 202 while the turn runs in the background; the 202 names the assistant message the reply lands in (\`messageId\`). Poll GET ${scope.item}/generation until status is idle, then read the messages. Send \`Idempotency-Key\` to make the send safe to retry: a repeat within 24 hours answers what the first attempt answered — the same \`messageId\` — with \`duplicate: true\` and queues nothing, and a repeat with a different body answers 409 \`IDEMPOTENCY_KEY_REUSED\`; a refused send remembers nothing. Every turn runs the built-in workspace assistant: its instructions, safety rules and three retrieval tools ride every request (about 3,000 prompt tokens per model round, counted in \`usage.inputTokens\` — a turn that calls a tool runs up to five rounds, each billing its full prompt again), and a request for a deliverable is redirected to Tasks by design — this is a conversation with the workspace, not a bare model call. A budget cap that binds the key holder — their own, one of their teams’, the organization’s or this API key’s — refuses the send with 429 \`BUDGET_EXCEEDED\` before anything is queued; a cap reached while an accepted send waited settles its \`messageId\` as failed with errorCode \`budget_exceeded\`. A turn failure appears as an assistant error message. Charges the execute bucket on top of the general REST bucket.`,
        operationId: scope.project ? 'postProjectThreadMessage' : 'postMessage',
        security: sec,
        parameters: [...itemParameters, sendIdempotencyKeyParam],
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
                'The prompt, trimmed before the length check — a blank prompt (nothing but whitespace and invisible format characters: zero-width spaces, joiners, bidi marks) is 400 `INVALID_BODY`, not a turn; markdown that renders as nothing, an empty code fence say, is still a prompt. The 100,000 cap counts UTF-16 code units, so an astral character — an emoji — costs two, and a body of 50,001 of them is refused. Text only: this surface takes no image or file input, on a `vision` model too — a data URI or base64 pasted here reaches the model as text and is answered as text; image attachments are the app’s composer.',
            },
            model: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description:
                'Model ID from GET /api/v1/models; never auto-selected. Checked at the door: without `providerSlug`, an id the list does not carry answers 400 `CHAT_MODEL_UNKNOWN` (and an id listed under several providers `CHAT_MODEL_AMBIGUOUS`); with a `providerSlug` the pair is judged instead — an unknown provider answers `CHAT_PROVIDER_UNKNOWN`, a listed provider that does not serve the id `CHAT_MODEL_NOT_ON_PROVIDER`.',
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
                'The reasoning depth, on the same five-step scale the app offers; omitted samples the model’s default. Ignored by a model whose `capabilities.reasoning` is false. A higher step spends more of the cap and of the bill — reasoning tokens count inside `maxOutputTokens` and inside `usage.outputTokens` at the output price — and at `high` or above a slower model can think for a minute or more before any answer; a turn has no fixed deadline, so bound your poll loop.',
            },
            maxOutputTokens: {
              type: 'integer',
              minimum: 1,
              description:
                'The largest reply this turn may produce across every model round, in tokens — a cap under the model’s own `maxOutputTokens` from GET /api/v1/models; a value above it answers 400 `INVALID_BODY`. Omitted, the model’s own ceiling applies. A tool-calling turn spends the cap round by round: a later round gets what the earlier ones left, and a round that would start with nothing left is not run. A reasoning model spends its reasoning inside the cap too, and the catalog does not say how much: a cap of a few thousand tokens can be consumed by the reasoning alone and settle an EMPTY reply — `complete`, `finishReason: "length"`, no text part, billed, the reasoning tokens counted inside `usage.outputTokens` at the output price — so give a reasoning model several thousand tokens or lower `reasoningEffort`. The one floor is the thinking-budget dialect (Anthropic-style extended thinking): there a cap under 2,048 is raised to 2,048; a model whose reasoning is set by an effort level (the GLM and DeepSeek families) has no floor and the cap bites exactly. A reply that runs into the cap still settles `complete`, cut short, and says so with `finishReason: "length"` on the message — a cut that fell on an earlier round’s tool calls included: every call of that round is withheld — it does not run and its tool-result reads `status: "invalid_args"`, the message saying whether its arguments were cut or complete.',
            },
            locale: {
              type: 'string',
              minLength: 2,
              maxLength: 20,
              pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$',
              description:
                'A BCP 47 language tag (`de`, `en-GB`) — the language the assistant is asked to answer in, whatever language the prompt is written in. The instruction rides the prompt as a directive, on the system prompt and on the message itself; a model may still slip (most often a reasoning model on a short prompt), and nothing on the wire marks a slip — a client that must have the language checks the reply and resends. An organization’s mandatory instructions win over `locale`. Omitted, the assistant answers in the prompt’s language.',
            },
          },
        }),
        responses: {
          '202': jsonResponse(
            'Turn accepted, or the send an earlier attempt under the same `Idempotency-Key` accepted',
            {
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
                duplicate: {
                  type: 'boolean',
                  enum: [true],
                  description:
                    'Present when the `Idempotency-Key` had already accepted this send: nothing new was queued — poll for the `messageId` it names',
                },
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
            },
          ),
          ...archivedProject,
          '404': notFound,
          '409': errorResponse(
            'The thread is archived (`CHAT_THREAD_ARCHIVED`) or not a direct chat (`CHAT_THREAD_NOT_DIRECT`), a turn is already running or still queued (`CHAT_TURN_IN_PROGRESS`) — nothing is queued and the running turn keeps its `messageId` — or the `Idempotency-Key` was already used for a different request (`IDEMPOTENCY_KEY_REUSED`)',
          ),
          ...standardErrors,
          '429': withDoorRefusal(
            standardErrors['429'],
            'a budget cap that binds the key holder is reached (`BUDGET_EXCEEDED`): nothing is queued, `data` names the cap — `scope`, `period`, `limitCode`, `used`, `limit`, `resetsAt` — and `Retry-After` the wait in whole seconds until its period resets',
          ),
          '400': errorResponse(
            'Invalid body (`INVALID_BODY`), a model the list does not carry (`CHAT_MODEL_UNKNOWN`), a model listed under several providers with none named (`CHAT_MODEL_AMBIGUOUS`), an unknown providerSlug (`CHAT_PROVIDER_UNKNOWN`), or a provider that does not serve the model (`CHAT_MODEL_NOT_ON_PROVIDER`)',
          ),
        },
      },
    };
    paths[`${scope.item}/messages/{messageId}`] = {
      get: {
        tags: ['Threads'],
        summary: 'Read one message',
        description: `${visibility} One message of the thread by id — the reply the 202 named (\`messageId\`), read without paging the transcript. The same shape as a row of GET ${scope.item}/messages: \`pending\` while its turn still runs, settled with \`finishReason\` and \`usage\` once the poll says idle. A message id the thread does not carry answers 404 \`MESSAGE_NOT_FOUND\`.`,
        operationId: scope.project ? 'getProjectThreadMessage' : 'getMessage',
        security: sec,
        parameters: [...itemParameters, pathParam('messageId', 'Message ID')],
        responses: {
          '200': jsonResponse('The message', ref('Message')),
          '404': errorResponse(
            'Thread missing, owned by another user, or outside the visible URL scope (`THREAD_NOT_FOUND`); or no such message on the thread (`MESSAGE_NOT_FOUND`)',
          ),
          ...standardErrors,
        },
      },
    };
    paths[`${scope.item}/generation`] = {
      get: {
        tags: ['Threads'],
        summary: 'Poll the running turn',
        description: `${visibility} \`queued\`: the accepted send is waiting for a worker (the 202 was answered, the turn has not opened) — accepted sends form one oldest-first queue shared by the whole deployment, worked in batches of up to five turns with the next batch starting only once the running one has settled, so a burst of sends completes in waves, not in parallel. \`streaming\`: the model is streaming its reply to the server — \`text\` and \`reasoning\` carry what has arrived so far, so a poller sees progress; send \`since\` (the UTF-16 code units of \`text\` you already hold — JavaScript \`String.length\`, an emoji counting two; not code points) and \`reasoningSince\` (the same for \`reasoning\`) to receive only what arrived after them, with \`textOffset\`/\`textLength\` and \`reasoningOffset\`/\`reasoningLength\` beside them — reassemble by one rule, \`held = held.slice(0, textOffset) + text\`, and send \`textLength\` back as \`since\`; there is no push channel on this surface. A turn has no fixed deadline — the server abandons one only after 180 seconds of provider silence — so bound your own loop and stop a turn you no longer want with DELETE ${scope.item}/generation. \`idle\`: no turn is running — \`lastMessageId\` and \`lastStatus\` name the newest assistant message and how it settled. The recipe after a send (or a lost 202): poll until \`idle\`, then compare \`lastMessageId\` with the \`messageId\` the 202 named — equal means your turn settled (read that message at GET ${scope.item}/messages/{messageId}, or page the messages with \`order=desc\`), a different id means yours has not started yet.`,
        operationId: scope.project
          ? 'getProjectThreadGeneration'
          : 'getGeneration',
        security: sec,
        parameters: [
          ...itemParameters,
          {
            ...queryParam(
              'since',
              'The number of UTF-16 code units (JavaScript `String.length` — an emoji counts two; not code points, not grapheme clusters) of `text` you already hold from an earlier poll: the answer carries only what arrived after them, `textOffset` says where the slice starts — the value you sent, one lower when that would have split a surrogate pair (an astral character is two units, and a slice opening on its second half would put an unpaired surrogate on the wire), or 0 when a tool round reset the reply — and `textLength` how long the whole reply is so far. Reassemble by one rule, `held = held.slice(0, textOffset) + text`, and send `textLength` back as `since`: it never falls inside a pair. Ignored unless the turn is streaming',
            ),
            schema: { type: 'integer', minimum: 0 },
          },
          {
            ...queryParam(
              'reasoningSince',
              'The number of UTF-16 code units (JavaScript `String.length`) of `reasoning` you already hold from an earlier poll — the `since` of the reasoning stream: the answer carries only what arrived after them, `reasoningOffset` says where the slice starts — the value you sent, one lower when that would have split a surrogate pair, or 0 when a tool round reset the reasoning with the text — and `reasoningLength` how long the whole reasoning is so far. Reassemble as `held = held.slice(0, reasoningOffset) + reasoning` and send `reasoningLength` back as `reasoningSince`. Ignored unless the turn is streaming',
            ),
            schema: { type: 'integer', minimum: 0 },
          },
        ],
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
                    'The reply text streamed so far — from `textOffset` on when `since` was sent, always whole characters (present while streaming)',
                },
                textOffset: {
                  ...int,
                  minimum: 0,
                  description:
                    'Where `text` starts, in UTF-16 code units: the `since` you sent, one lower when that would have split a surrogate pair, or 0 when the reply was reset since — reassemble as `held = held.slice(0, textOffset) + text` (present while streaming)',
                },
                textLength: {
                  ...int,
                  minimum: 0,
                  description:
                    'The length of the whole reply streamed so far, in UTF-16 code units (JavaScript `String.length`) — send it back as `since` on the next poll; it never falls inside a surrogate pair (present while streaming)',
                },
                lastMessageId: {
                  type: 'string',
                  description:
                    'The newest assistant message on the thread (present while idle, once the thread has one) — compare with the `messageId` a 202 named to know whether that turn settled',
                },
                lastStatus: {
                  type: 'string',
                  enum: ['pending', 'complete', 'failed', 'cancelled'],
                  description: 'How `lastMessageId` settled (present with it)',
                },
                reasoning: {
                  type: 'string',
                  description:
                    'The model’s reasoning streamed so far — from `reasoningOffset` on when `reasoningSince` was sent, always whole characters; display-only, may be empty (present while streaming)',
                },
                reasoningOffset: {
                  ...int,
                  minimum: 0,
                  description:
                    'Where `reasoning` starts, in UTF-16 code units: the `reasoningSince` you sent, one lower when that would have split a surrogate pair, or 0 when the reasoning was reset since (present while streaming)',
                },
                reasoningLength: {
                  ...int,
                  minimum: 0,
                  description:
                    'The length of the whole reasoning streamed so far, in UTF-16 code units — send it back as `reasoningSince` on the next poll; it never falls inside a surrogate pair (present while streaming)',
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
        description: `${visibility} Asks the running turn to stop — the app’s own stop: the turn reads the flag at its next progress write and settles what it has. 202 means the stop is requested, not done; poll until idle. A send still queued (no worker has opened it) is stopped the same way: 202 naming the reply the send’s 202 promised, the model is never called, and that reply settles as \`cancelled\` with empty \`parts\`. Nothing running and nothing queued answers 404 \`CHAT_TURN_NOT_RUNNING\` with \`data.lastMessageId\` and \`data.lastStatus\` — the idle poll’s answer, so a stop that lost the race against a fast model needs no second call.`,
        operationId: scope.project
          ? 'cancelProjectThreadGeneration'
          : 'cancelGeneration',
        security: sec,
        parameters: itemParameters,
        responses: {
          '202': jsonResponse(
            'Cancellation requested — of the running turn, or of the queued send',
            {
              type: 'object',
              required: ['status'],
              properties: {
                status: { type: 'string', enum: ['cancelling'] },
                messageId: {
                  type: 'string',
                  description:
                    'The assistant message the turn was writing, or the one the queued send was to write',
                },
              },
            },
          ),
          ...archivedProject,
          '404': errorResponse(
            'Thread missing, owned by another user, or outside the visible URL scope (`THREAD_NOT_FOUND`); or no turn is running and no send is queued (`CHAT_TURN_NOT_RUNNING` — `data.lastMessageId` and `data.lastStatus` name the newest assistant message, as the idle poll does)',
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
        'One skill bundle: the summary fields plus the body and the file list, with the document’s entity tag as `ETag` — send it back as `If-Match` on a save, or as `If-None-Match` on the next read to get 304 while the document is unchanged. A malformed slug answers 404 like an unknown one.',
      security: sec,
      parameters: [
        skillSlugParam,
        {
          name: 'If-None-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'The `etag` you hold (or a list, or `*`): when it names the current document — weak comparison, so a `W/` prefix counts — the answer is 304 with the tag and no body',
        },
      ],
      responses: {
        '200': {
          ...jsonResponse('The skill', ref('Skill')),
          headers: { ETag: headerRef('ETag') },
        },
        '304': {
          description:
            'Not modified: `If-None-Match` named the current document (weakly — the `W/` and the edge-suffixed `"…-gzip"` forms match); `ETag` repeats the tag, `Cache-Control` says `private, no-cache` as the 200 does, no body',
          headers: {
            ETag: headerRef('ETag'),
            'Cache-Control': headerRef('CacheControl'),
          },
        },
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
        'Creates the bundle when the slug is free — **201** — and updates it ' +
        'in place otherwise — **200** — so the status is the create-or-update ' +
        'signal (the same convention as a task materialisation) and a sync ' +
        'that mirrors bundles from elsewhere needs no read first: ' +
        '`description` and `body` are required; an omitted ' +
        '`icon`, `labels`, `teams`, `visibility` or `disableModelInvocation` ' +
        'keeps its stored value, `null` clears `icon` or `labels`, and ' +
        '`disableModelInvocation: false` drops the flag. A body that does ' +
        'not end with a newline gets one appended. The save rewrites ' +
        '`SKILL.md` only — every other file of the bundle stays, and ' +
        'frontmatter keys the body does not carry (`license`, ' +
        '`recommended-packages`, community keys) are preserved; replacing a ' +
        'whole bundle is the app’s zip upload. Guard an update with ' +
        '`If-Match`: the `etag` you last read (the GET’s `ETag`) — a ' +
        'document that changed since, or is not there, answers 412 ' +
        '`SKILL_STALE` with the current tag in `data.etag` and nothing is ' +
        'written. Send `If-None-Match: *` to create only — a slug that ' +
        'already has a bundle then answers 412 `SKILL_EXISTS` and nothing ' +
        'is written. The body is validated before the preconditions are ' +
        'evaluated. A save whose composed `SKILL.md` is byte-identical to ' +
        'the stored document writes nothing — 200 with the stored `etag` ' +
        'and `updatedAt`, no history entry — the preconditions still ' +
        'evaluated first, so a stale `If-Match` on an identical body is ' +
        'still 412. Every skill carries `canEdit`: whether this key may edit ' +
        'the bundle; shipped skills are organization bundles an ' +
        'administrator may overwrite, so check it before a save that means ' +
        'to replace one. The body may run to 4 MiB — this operation’s own ' +
        'cap, so the worst JSON escaping of a full-size `body` still fits; ' +
        'past it the answer is 413 `BODY_TOO_LARGE`.',
      operationId: 'saveSkill',
      security: sec,
      parameters: [
        skillSlugParam,
        {
          name: 'If-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'The `etag` you last read — strong comparison, so a `W/` tag never matches — or `*`: the save proceeds only when the stored SKILL.md still carries that tag (`*`: when one is stored at all); otherwise 412 `SKILL_STALE`, `data.etag` naming the current tag (`null` when nothing is stored), nothing written. Evaluated before `If-None-Match`, inside the same lock as the write.',
        },
        {
          name: 'If-None-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'Send `*` to create only: a slug that already has a bundle answers 412 `SKILL_EXISTS` and nothing is written. A tag list refuses the same way when the stored document weakly matches one of its tags (its current `etag`, with or without `W/`); any other value matches nothing and the write goes ahead.',
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
          disableModelInvocation: {
            type: 'boolean',
            description:
              'True keeps the model from reaching for the skill on its own (it stays available by explicit name); omitted keeps the stored value, `false` drops the flag',
          },
        },
      }),
      responses: {
        '200': jsonResponse(
          'The skill this save updated in place — its `etag` names the version just written, or the stored one when the body changed nothing (then `updatedAt` stays too)',
          ref('Skill'),
        ),
        '201': jsonResponse(
          'The skill this save created (the slug was free) — its `etag` names the version just written',
          ref('Skill'),
        ),
        '403': errorResponse('Not editable with this key (`SKILL_FORBIDDEN`)'),
        '412': errorResponse(
          'A precondition failed and nothing was written: `If-Match` named no tag matching the stored SKILL.md, or `*` with nothing stored (`SKILL_STALE` — `data.etag` carries the current tag, `null` when nothing is stored); or `If-None-Match: *` was sent and the slug already has a bundle, or a tag list named its current tag (`SKILL_EXISTS`)',
        ),
        '422': errorResponse(
          'The bundle already stored under the slug cannot be read — a planted symlink, a file over the 4 MiB staging cap, a `SKILL.md` that does not parse (`SKILL_MALFORMED`); never the body you send, which is refused as 400 (`INVALID_BODY`, `INVALID_SKILL`)',
        ),
        '413': errorResponse(
          'The body exceeds 4 MiB — this operation’s own cap, above the door’s 1 MiB default, so the worst JSON escaping of a full-size `body` still fits (`BODY_TOO_LARGE`); the envelope carries a `requestId`',
        ),
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
        'Delete the bundle the slug names — its owner, or an administrator; a malformed or unknown slug answers 404 `SKILL_NOT_FOUND` (no precondition is evaluated on an absent slug). `If-Match` guards it like the save: a tag that no longer matches the stored SKILL.md answers 412 `SKILL_STALE` and the bundle stays.',
      security: sec,
      parameters: [
        skillSlugParam,
        {
          name: 'If-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'The `etag` you last read, or `*`: the delete proceeds only when the stored SKILL.md still carries that tag; otherwise 412 `SKILL_STALE` with the current tag in `data.etag`',
        },
        {
          name: 'If-None-Match',
          in: 'header' as const,
          required: false,
          schema: { type: 'string' },
          description:
            'A tag list (or `*`): the delete proceeds only when the stored document weakly matches none of them; otherwise 412 `SKILL_EXISTS`',
        },
      ],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('Not deletable with this key (`SKILL_FORBIDDEN`)'),
        '404': errorResponse(
          'No such skill, or a malformed slug (`SKILL_NOT_FOUND`)',
        ),
        '412': errorResponse(
          'A precondition failed and the bundle stays: `If-Match` named no tag matching the stored SKILL.md (`SKILL_STALE`, `data.etag` carries the current tag), or `If-None-Match` named it (`SKILL_EXISTS`)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/skills/{slug}/files/{path}'] = {
    get: {
      tags: ['Skills'],
      summary: 'Download a bundle file',
      operationId: 'downloadSkillFile',
      description:
        'The bytes of one file of the bundle — `SKILL.md` included — exactly ' +
        'as the organization’s tree holds it: `application/octet-stream`, ' +
        '`Content-Length`, the file’s own name in an RFC 6266 ' +
        '`Content-Disposition`, private and uncacheable; a HEAD request ' +
        'answers the headers alone. The skill’s `files[]` is the only ' +
        'legitimate source of paths: a path it would never list — a ' +
        'traversal, a dot-entry, `node_modules/…` — reads as a file the ' +
        'bundle does not have (404 `SKILL_FILE_NOT_FOUND`), where an ' +
        'unknown, invisible or malformed slug is 404 `SKILL_NOT_FOUND`. A ' +
        'raw dot-segment in the URL (`../`, or `%2e%2e/` — the dots ' +
        'encoded, the slash not) never reaches this operation: the edge ' +
        'refuses it first with its own 404 `NOT_FOUND`, without ' +
        '`X-Tale-Api-Version`; a spelling whose slashes are encoded too ' +
        '(`%2e%2e%2f…`) does, and reads as `SKILL_FILE_NOT_FOUND`. A ' +
        'bundle the file layer refuses to read — a planted symlink, a file ' +
        'over the 4 MiB staging cap — answers 422 `SKILL_MALFORMED`.',
      security: sec,
      parameters: [
        skillSlugParam,
        pathParam(
          'path',
          'The file’s bundle-relative path exactly as `files[].path` lists it — nested segments separated by `/`, raw or percent-encoded (`%2F`)',
        ),
        {
          name: 'If-None-Match',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'The `ETag` a previous answer carried (the tag is over the file’s ' +
            'bytes; the weak `W/` form matches too): unchanged bytes answer ' +
            '304 with no body. Takes precedence over `If-Modified-Since`.',
        },
        {
          name: 'If-Modified-Since',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'The `Last-Modified` a previous answer carried: a file not ' +
            'modified since answers 304, judged at whole-second precision. ' +
            'Ignored when `If-None-Match` is present.',
        },
      ],
      responses: {
        // The bytes are validated like every download door — `ETag` over the
        // file, `Last-Modified` from its mtime, 304 on `If-None-Match` /
        // `If-Modified-Since` — but the operation declared none of it, so a
        // generated client had no branch for the 304 the door answers
        // (2026-09-18 evaluation, J1-1).
        '200': {
          description: 'The bytes, named by `Content-Disposition`',
          headers: {
            'Content-Disposition': headerRef('ContentDisposition'),
            'Content-Length': headerRef('ContentLength'),
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Cache-Control': headerRef('CacheControl'),
          },
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        '304': {
          description:
            'Not Modified — `If-None-Match` named the current `ETag` (or ' +
            '`If-Modified-Since` the current `Last-Modified`), so no bytes ' +
            'are sent; `ETag`, `Last-Modified` and `Cache-Control` ride along',
          headers: {
            ETag: headerRef('ETag'),
            'Last-Modified': headerRef('LastModified'),
            'Cache-Control': headerRef('CacheControl'),
          },
        },
        '404': errorResponse(
          'No such skill, none this key may see, or a malformed slug (`SKILL_NOT_FOUND`); or a skill without a file at that path (`SKILL_FILE_NOT_FOUND`)',
        ),
        '422': errorResponse('The bundle cannot be read (`SKILL_MALFORMED`)'),
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
        description:
          'Markdown. Leading and trailing whitespace is removed before the length check and before storing; the cap counts UTF-16 code units, so an astral character (an emoji) costs two.',
      },
    },
  };

  paths['/api/v1/knowledge-entries'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'List knowledge entries',
      description:
        'Newest first; `cursor` is the previous page’s `continueCursor`. ' +
        '`topic` narrows the page to one topic — with `status=superseded` ' +
        'that is a fact’s replaced versions, each with its `supersededAt`; ' +
        '`GET /api/v1/knowledge-entries/{id}/versions` answers the same ' +
        'chain from any of its rows.',
      operationId: 'listKnowledgeEntries',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('status', '`active` (default) or `superseded`'),
        queryParam(
          'topic',
          'Only this topic’s entries, matched the way duplicates are — trimmed, inner whitespace collapsed, case-insensitive; composable with `status`',
        ),
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
        '(`sourceProvider: knowledge`) and queues it for indexing, so the ' +
        'content is searchable once its `indexing` completes — the one way ' +
        'to put text into the search corpus from REST. The 201 answers the ' +
        'entry’s `id` AND that `documentId`: poll ' +
        '`GET /api/v1/documents/{documentId}` for `indexing` directly. A ' +
        'supersede re-indexes under the same `documentId`; a delete trashes ' +
        'it. The document itself refuses a direct delete or content edit ' +
        '(`DOCUMENT_HAS_KNOWLEDGE_ENTRY`); its bytes read back at ' +
        '`GET /api/v1/documents/{documentId}/content`. Requires the ' +
        'knowledge write grant (editor and up).',
      operationId: 'createKnowledgeEntry',
      security: sec,
      requestBody: jsonBody(knowledgeEntryBody),
      responses: {
        '201': jsonResponse(
          'Created — the entry’s id and the Hub document it is stored in',
          ref('KnowledgeEntryCreated'),
        ),
        '403': errorResponse(
          'The key holder’s role cannot modify knowledge entries (`KNOWLEDGE_ENTRY_FORBIDDEN`)',
        ),
        '409': errorResponse(
          'An active entry with this topic exists (`KNOWLEDGE_ENTRY_DUPLICATE`)',
        ),
        '503': errorResponse(
          'The object store did not accept the entry’s content within 30 seconds (`KNOWLEDGE_ENTRY_STORE_TIMEOUT`) — nothing was written; retry',
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
        'One knowledge entry — active or superseded — with its topic, content, version (`supersededBy` and `supersededAt` on a replaced row) and the Hub document behind it.',
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
        'id (with the `documentId` it re-indexes under); the old row ' +
        'becomes `superseded`, stamped with `supersededAt`. Both `topic` ' +
        'and `content` are required. A write that repeats the active row ' +
        '— the same `topic` and `content` after trimming — writes no ' +
        'version and answers the active row’s own id (the documents PATCH ' +
        'rule), so a retry or a replaying sync job never inflates the ' +
        'history; a case-only change of the topic is a change. Only the ' +
        'ACTIVE row of a topic takes an update — a superseded row answers ' +
        '409 naming the topic’s ACTIVE row (`data.activeId`, beside ' +
        '`data.supersededBy`, its direct successor), an identical body ' +
        'included, so a stale id costs one round trip, never a chase down ' +
        'the chain. ' +
        'Requires the knowledge write grant (editor and up).',
      operationId: 'updateKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      requestBody: jsonBody(knowledgeEntryBody),
      responses: {
        '200': jsonResponse(
          'The NEW row’s id and the document it re-indexes under — or, for a body that repeats the active row, that row’s id with nothing written',
          ref('KnowledgeEntryCreated'),
        ),
        '403': errorResponse(
          'The key holder’s role cannot modify knowledge entries (`KNOWLEDGE_ENTRY_FORBIDDEN`)',
        ),
        '404': errorResponse('Entry not found (`KNOWLEDGE_ENTRY_NOT_FOUND`)'),
        '409': errorResponse(
          'Entry is not active — it was superseded (`KNOWLEDGE_ENTRY_SUPERSEDED`; ' +
            '`data.activeId` names the row to update, when the topic still has one), ' +
            'or the new topic collides with another active entry ' +
            '(`KNOWLEDGE_ENTRY_DUPLICATE`)',
        ),
        '503': errorResponse(
          'The object store did not accept the new version within 30 seconds (`KNOWLEDGE_ENTRY_STORE_TIMEOUT`) — nothing was written; retry',
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
        '403': errorResponse(
          'The key holder’s role cannot modify knowledge entries (`KNOWLEDGE_ENTRY_FORBIDDEN`)',
        ),
        '404': errorResponse(
          'Entry not found, including one already deleted (`KNOWLEDGE_ENTRY_NOT_FOUND`)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/knowledge-entries/{id}/versions'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'List a knowledge entry’s versions',
      description:
        'The whole version chain of the entry’s topic, newest first — the ' +
        'active row and every superseded one (`supersededBy`, ' +
        '`supersededAt`), from any row of the chain. The chain is keyed by ' +
        'the Hub document every version re-materializes onto, so a topic ' +
        'rename keeps it together; a version pruned with ' +
        '`DELETE /api/v1/knowledge-entries/{id}` is not listed. The same ' +
        'history the app’s entry panel shows — the whole chain at once, ' +
        'not paginated.',
      operationId: 'listKnowledgeEntryVersions',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '200': jsonResponse(
          'The chain, newest first',
          listOf('versions', ref('KnowledgeEntry')),
        ),
        '404': errorResponse('Entry not found (`KNOWLEDGE_ENTRY_NOT_FOUND`)'),
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
          ? 'Searches only indexed files attached to the URL project (a project file indexes when bound with `skipRagIndexing: false`, or later through `POST /api/v1/projects/{id}/files/{documentId}/retry-indexing`). Requires project read access; archived project files remain searchable. Corpus defaults to documents and accepts only documents. Hub files, other projects, websites and conversation attachments are excluded.'
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
                'Cosine floor for the dense (vector) leg only — applied before fusion, so a passage under it is never ranked. No default on this door: without it the nearest passages answer however weak; the keyword leg is never floored. The built-in assistant’s search applies the organization’s configured floor instead (`embedding.json` `minSimilarity`, 0.45 when unset). Threshold the answer on each hit’s `similarity` for the hits the vector leg ranked (`matchedLegs` contains `…:dense`), never on `fusedScore` — and keep a hit only the keyword leg found (`similarity: null`, its `keywordScore` set): an exact identifier or phrase match is stronger evidence than any cosine',
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
              'A stable delivery ID. Read from the first non-blank of, in this order: `Idempotency-Key`, `X-Idempotency-Key`, `Webhook-Id` (Standard Webhooks), `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. Matched by value, whichever header carried it, and never by body: a delivery whose ID was already accepted inside 24 hours answers 202 `duplicate: true` with the FIRST delivery’s run, and its body is not run — unlike `POST …/runs`, which refuses a reused key with a different body (409 `IDEMPOTENCY_KEY_REUSED`); a vendor’s redelivery must never loop on a 409. Send a new ID per distinct event. Any characters, no length cap.',
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

  // The headers every answer through the app carries — the request id and
  // the contract version the instance implements — declared once for the
  // REST door and the two webhook doors below, so the pair cannot drift.
  const doorHeaders: Record<string, keyof typeof responseHeaders> = {
    'X-Request-Id': 'XRequestId',
    'X-Tale-Api-Version': 'XTaleApiVersion',
  };
  // The door's own contract is a property of every `/api/v1` operation,
  // not of a family, so it is stamped on each here rather than repeated by
  // hand: the tenant header (a multi-organization key MUST send it on
  // every call; a single-organization key may omit it), the two refusals
  // that header can draw (403 `ORG_FORBIDDEN`, 404 `ORG_SLUG_INVALID`),
  // the 405 a served path answers for a method it does not take, the 500
  // every operation can end in, and the 413 every operation with a body
  // answers past its byte cap. A family's own sentence for a status keeps
  // the lead; the door's clause is appended to it.
  /** The creates whose 201 names the created resource in `Location`. */
  const LOCATION_201_PATHS = new Set([
    '/api/v1/contacts',
    '/api/v1/products',
    '/api/v1/documents',
    '/api/v1/knowledge-entries',
    '/api/v1/projects',
    '/api/v1/projects/{id}/agents',
    '/api/v1/projects/{id}/folders',
    '/api/v1/projects/{id}/files',
    '/api/v1/projects/{id}/tasks',
    '/api/v1/threads',
    '/api/v1/projects/{id}/threads',
    '/api/v1/websites',
    '/api/v1/skills/{slug}',
  ]);
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
      if (
        !(op.parameters ?? []).some(
          (parameter) =>
            parameter.in === 'header' &&
            parameter.name === requestIdHeaderParam.name,
        )
      ) {
        op.parameters = [...(op.parameters ?? []), requestIdHeaderParam];
      }
      const responses = op.responses;
      // A 201 that creates one addressable resource names it: `Location`,
      // the resource’s own path, so a generic client follows it whatever
      // shape the body has (2026-09-14 evaluation, h1). The bulk import
      // creates many and carries none; a comment has no read of its own.
      if (responses['201'] !== undefined && LOCATION_201_PATHS.has(path)) {
        withHeaders(responses['201'], { Location: 'Location' });
      }
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
      // Every JSON read is a validated read (lib/conditional-get.ts): the
      // 200 carries an `ETag` over its bytes, and the same request with
      // that tag in `If-None-Match` answers 304 without the body.
      const ok = responses['200'] as
        | { content?: Record<string, unknown>; headers?: Record<string, Json> }
        | undefined;
      if (method === 'get' && ok?.content?.['application/json'] !== undefined) {
        ok.headers = {
          ...ok.headers,
          ETag: headerRef('ETag'),
          'Cache-Control': headerRef('CacheControl'),
        };
        responses['304'] ??= {
          description:
            'Not Modified — `If-None-Match` named the current `ETag`, so the body is not sent',
          headers: {
            ETag: headerRef('ETag'),
            'Cache-Control': headerRef('CacheControl'),
          },
        };
      }
      // The headers every answer on the door carries, and the ones a
      // status implies: a 401's challenge, a 405's `Allow`, the wait a 429
      // (or a 503 that names it) asks for.
      for (const [status, response] of Object.entries(responses)) {
        withHeaders(response, doorHeaders);
        if (status === '401') {
          withHeaders(response, { 'WWW-Authenticate': 'WWWAuthenticate' });
        }
        if (status === '405') withHeaders(response, { Allow: 'Allow' });
        if (
          status === '429' ||
          (status === '503' &&
            typeof response.description === 'string' &&
            response.description.includes('Retry-After'))
        ) {
          withHeaders(response, { 'Retry-After': 'RetryAfter' });
        }
      }
    }
  }
  // The two token-authenticated webhook doors live outside `/api/v1` but
  // answer through the same app and sit in this document: the request id
  // and the contract version on every response (the REST door's stamper is
  // mounted on both in app.ts — a sender pinning to a version used to read
  // no header at all, 2026-09-13 round-e evaluation), the wait on a 429.
  for (const [path, operations] of Object.entries(paths)) {
    if (!path.includes('/automations/webhook/')) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = operation as { responses: Record<string, Json> };
      for (const [status, response] of Object.entries(op.responses)) {
        withHeaders(response, doorHeaders);
        if (status === '429') {
          withHeaders(response, { 'Retry-After': 'RetryAfter' });
        }
      }
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Tale Platform API',
      version: API_CONTRACT_VERSION,
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

## Caching and compression

Every JSON read (a \`GET\` answering 200) carries an \`ETag\` over its bytes
and \`Cache-Control: private, no-cache\`: keep the answer, and send the tag
back as \`If-None-Match\` on the next read — an unchanged resource answers
**304** with no body. File content (\`GET .../files/{documentId}/content\`)
honours \`If-None-Match\` and \`If-Modified-Since\` against the \`ETag\` and
\`Last-Modified\` it issues, the same way. A 304 still counts against the
request budget; a read that only needs a few keys of a large resource should
name them where the operation offers \`fields\` (run reads do). Responses are
compressed with \`gzip\` or \`zstd\` when the request offers one in
\`Accept-Encoding\` (\`curl --compressed\`), above a floor of about 512
bytes; \`br\` is not served. A
compressed answer's \`Content-Length\`, when present, is the compressed size
(a large answer streams without one) and its \`ETag\` carries the
\`-gzip\`/\`-zstd\` suffix; a HEAD is never compressed and reports the
uncompressed length.

## Authentication

Every \`/api/v1\` request carries an organization API key (create one in
Settings → API; a key starts with \`tale\` and carries no separator — treat
the whole string as opaque):

\`\`\`
Authorization: Bearer <api-key>
\`\`\`

Inbound automation webhooks authenticate with their URL token. The key is
read from \`Authorization\` alone: a request that carries one as
\`x-api-key\` — the header the platform's own door uses internally — is
refused with 401 whatever else it carries; a valid \`Authorization\` header
alongside it does not rescue it.

If you belong to several organizations, send \`X-Organization-Slug\` on
every request, reads included — without it the request answers 400
\`ORG_SLUG_REQUIRED\`; a slug that names no organization answers 404
\`ORG_SLUG_INVALID\`, one you are no member of 403 \`ORG_FORBIDDEN\` — told
apart on purpose: a slug is the public path segment of every app URL, not a
secret, and the probe is already authenticated and rate-limited; resource ids
never get this treatment (an id you cannot see answers the same 404 as one
that does not exist). The
400 lists the slugs you may send under \`data.organizations\`; \`GET
/api/v1/me\` lists them too, as its top-level \`organizations\`. The slug
is matched without regard to case; a blank or whitespace-only header reads
as absent.

## Requests

Bodies are JSON, read strictly: UTF-8 only, no NUL character, and a whole
number beyond 2^53 − 1 is refused rather than rounded (send such an id as a
string). Every body schema is strict — an unknown key answers 400
\`INVALID_BODY\` naming it, and a key given twice keeps its last value — and
so is every query string: a parameter a
route does not take, one given twice, or a named filter left blank answers
400 \`INVALID_QUERY\`, and writes take no query parameters at all. An
out-of-range number is handled by where it travels: a query parameter
(\`limit\`) is clamped into its range, while a body field (a search
\`limit\`, \`maxOutputTokens\`) is refused with 400 \`INVALID_BODY\` naming it.
A body is capped at 1 MiB unless the operation says otherwise (a document's inline
content 32 MiB, the contacts bulk import 8 MiB, a conversation snapshot 8
MiB, a staged conversation upload 30 MiB, a skill save 4 MiB, a delivery
claim, failure report or acknowledgement 64 KiB); past the cap
the answer is 413 \`BODY_TOO_LARGE\`, before a byte is read when the length
is declared — the platform reads none of it, though over HTTP/1.1 the edge
may still drain up to 256 KiB of it before the refusal reaches you — and at
the first chunk past the cap when it is not: an oversized body is never
read in full. A body that ends before its declared length is a malformed
request: over HTTP/2 the edge answers 400 \`BODY_LENGTH_MISMATCH\` (the
platform's 413 instead when the declared length was over the cap and its
refusal won the race); over HTTP/1.1 the missing bytes are waited for until
the 15-minute arrival deadline. An HTTP/1.1 chunked body whose framing is
malformed — a chunk size that is not hexadecimal, a bare LF, a missing CRLF —
is refused at the edge with 400 \`BODY_CHUNK_MALFORMED\`, a client error that
no retry can fix (it used to read as a 502 outage with retry advice). A request must finish arriving within 15
minutes, headers and
body together — a 30 MiB upload needs roughly 35 KB/s; slower answers 408
\`REQUEST_TIMEOUT\` in the envelope (with a fresh \`requestId\`) and the
connection closes. Every answer is JSON whatever \`Accept\` says — \`application/xml\`,
\`text/plain\`, even \`application/json;q=0\` — there is no 406: the surface has
one representation. Bodies are read as JSON whatever Content-Type says; there is no
415. Every served path answers HEAD (for a GET, with the \`Content-Length\`
the uncompressed GET would carry — a HEAD is never compressed) and OPTIONS
(204 with \`Allow\`, no key needed); a
method a path does not take answers 405 \`METHOD_NOT_ALLOWED\` with
\`Allow\`; one trailing slash on a path is tolerated. The surface is
server-to-server: no response on this surface carries CORS headers (the
status page's JSON is the one keyless exception), so a browser page cannot
call it — keep the key behind your own backend. A request URL (path
and query) above 32 KiB answers 414 \`URI_TOO_LONG\` in the envelope, before
any route is looked up. Request headers as a whole are budgeted at 64 KiB
at the edge: HTTP/1.1 allows a few KiB of slack before its bare 431 without
the envelope, so a URL or header just past 64 KiB may still reach the
platform and be judged by its rules (a 66 KiB URL still answers 414); on
HTTP/2 the budget is exact and the connection is closed without a response
— carry data in the body, never in a header. A header value carrying a
control character — below 0x20
other than tab, or DEL — never reaches the platform either: HTTP/1.1 answers
a bare text 400 at the edge, HTTP/2 resets the stream or, on a request with
a body, closes the connection. Every response from this surface carries an
\`X-Request-Id\` — send your own to correlate: up to 255 characters of
letters, digits, \`_\`, \`-\` and \`=\`; anything else is replaced by a
fresh UUID — replaced rather than refused because a correlation id is
best-effort: the call goes through even when the id cannot be logged, and the
id the platform did use is on the response for you to record. An
\`Idempotency-Key\` is the opposite kind of value, a promise the platform
keeps byte for byte, so one it cannot keep is refused (400 \`INVALID_HEADER\`) — on the operations that declare the header (a run start, a chat send; the webhook doors read it as a delivery id under their own rule); an operation that does not declare it ignores the header, its at-most-once guard being the natural key its body names
instead. Every response the platform answers also names the contract it
implements in \`X-Tale-Api-Version\`; a refusal answered at the edge — a
dot-segment 404, a body shorter than its declared length (400
\`BODY_LENGTH_MISMATCH\`), a malformed HTTP/1.1 chunked body (400
\`BODY_CHUNK_MALFORMED\`), a 502/503/504 while the platform restarts
(\`UPSTREAM_UNAVAILABLE\`) — carries a fresh id of its own and no version
header: only the platform knows the contract it implements.

## Errors

Non-2xx responses carry a flat envelope: \`{"error": "<sentence>", "code":
"<CODE>"}\`. Every refusal carries a stable \`code\` — the \`Error.code\` enum
below, additive, so treat a value you do not know as a generic refusal of
the status you got. A 429 carries a sentence in \`error\` like every other
refusal, with the wait in \`data.retryAfterMs\` (milliseconds) and
\`Retry-After\` (whole seconds); a 429, a 500, a body-size 413 and a URL-size
414 add \`requestId\`; a refused body or query
lists every problem under \`data.issues\`, each naming the field (\`path\`)
and the reason as a short phrase you can show a person — \`is required\`,
\`must be a string\`, \`must not be blank\`, \`must be at most 200
characters\`, \`must be one of "a", "b"\` — and a refused \`limit\` or
\`cursor\` (\`INVALID_LIMIT\`, \`INVALID_CURSOR\`) names its parameter there
too, so branch on \`path\` and the \`code\`, never on the sentence. The door's own refusals are
\`UNAUTHORIZED\`, \`ORG_SLUG_REQUIRED\`, \`ORG_SLUG_INVALID\`,
\`ORG_FORBIDDEN\`, \`INVALID_URL\` (a NUL in the URL), \`URI_TOO_LONG\`,
\`INVALID_QUERY\`, \`INVALID_LIMIT\`, \`INVALID_CURSOR\`, \`INVALID_BODY\`,
\`BODY_TOO_LARGE\`, \`METHOD_NOT_ALLOWED\`, \`NOT_FOUND\`, \`RATE_LIMITED\`,
\`REQUEST_TIMEOUT\` (408 — the request did not finish arriving within 15
minutes; the connection closes), \`HTTP_ERROR\` (a refusal a middleware or
the listener itself raised — bytes that are not HTTP, a header block past
the budget), \`BODY_LENGTH_MISMATCH\` (400, answered at the edge — an HTTP/2
body that ended before its declared Content-Length), \`BODY_CHUNK_MALFORMED\`
(400, answered at the edge — an HTTP/1.1 chunked body whose framing is
malformed), \`UPSTREAM_UNAVAILABLE\`
(502, 503 or 504, answered at the edge with \`Retry-After\` while the
platform restarts or cannot be reached — the maintenance page a browser
gets, as JSON) and \`INTERNAL_ERROR\`.

## Pagination

One rule: a paginated list takes \`cursor\` + \`limit\` and answers \`isDone\`
with a \`continueCursor\` — pass \`continueCursor\` back as \`cursor\`,
unchanged, until \`isDone\` (it is empty then). Every list's 200 schema
names its family in \`x-tale-pagination\`, so a generated client picks the
loop from the document rather than from this prose:

- **keyset** — the rows sit under \`page\` on the knowledge and chat lists
  (contacts, products, documents, knowledge entries, threads, messages,
  websites) and under the resource's own key elsewhere: \`{runs, …}\`,
  \`{deliveries, …}\`, \`{conversations, …}\`, \`{comments, …}\`,
  \`{projects, …}\`, \`{files, …}\`.
  The last two also answer \`cursor\` — the same token under its pre-1.5.0
  name, present only while more pages remain, deprecated and served for at
  least two more minor versions; a project lookup by \`externalItemId\` is
  one whole page and says so.
- **offset** — website pages alone: \`{pages, total, offset, hasMore}\`,
  with \`isDone\` and a \`continueCursor\` (the next \`offset\`, signed)
  beside them, so the same loop walks it; \`cursor\` and \`offset\` together
  are refused (400 \`INVALID_QUERY\`).
- **none** — a named array alone is the complete set (or the bounded roster
  the operation names), never a cursor walk — no \`isDone\`, no cursor, no
  \`cursor\` or \`limit\` parameter: \`{automations}\`, \`{agents}\`,
  \`{skills}\`, \`{folders}\`, \`{models}\`, \`{sessions}\`, \`{versions}\`,
  \`{triggers}\`, \`{teams}\`; search answers \`{hits, diagnostics}\`.

Every cursor is an opaque signed token: one this list never answered is
refused with 400 \`INVALID_CURSOR\`, never read as the first page — and a
blank \`cursor\` (the empty \`continueCursor\` the last page answers) is
refused like any blank parameter (400 \`INVALID_QUERY\`), so a pager that
sends the last page's cursor back stops instead of starting over.

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

## Versioning

\`info.version\` is the contract's own semver: a minor bump for an additive
change (a new operation, field, header or error code), a major one for a
removal or a changed meaning. Every response carries the version the
instance implements as \`X-Tale-Api-Version\`; each release's notes list
the changes under **API contract changes**. The build (\`GET /api/health\`)
and the \`/api/v1\` prefix are separate numbers: the prefix is the
compatibility line, retired only with notice.

## Quick start

\`\`\`bash
# 0. Find a project (the id every project URL takes)
curl -H "Authorization: Bearer <api-key>" \\
  -H "X-Organization-Slug: <orgSlug>" \\
  "https://your-instance.com/api/v1/projects"

# 1. List the automations installed in it
curl -H "Authorization: Bearer <api-key>" \\
  -H "X-Organization-Slug: <orgSlug>" \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations"

# 2. Start one that is deployed (spell a "/" in its name as "__"); the 202
#    answers {"runId": …}
curl -X POST -H "Authorization: Bearer <api-key>" \\
  -H "X-Organization-Slug: <orgSlug>" \\
  -H "Content-Type: application/json" -d '{"input": {}}' \\
  "https://your-instance.com/api/v1/projects/<projectId>/automations/<automationName>/runs"

# 3. Poll it with that runId
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
        description:
          'Versioned automations, their runs and triggers — list, read, install, bind, run, cancel and delete. Authoring (save, validate, test, deploy) is not on this surface: it lives on `POST /api/v1/mcp` (`save_automation`, `validate_automation`, `test_automation`, `deploy_automation`, `set_trigger` — the MCP endpoint page of the developer docs), in the app’s automation editor, and in `tale deploy` for configuration packs. A deleted automation comes back by saving and deploying it again there.',
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
      {
        name: 'Notifications',
        description:
          'Read-only, recipient-scoped notification exports for connected applications.',
      },
    ],
    paths,
    components: {
      headers: responseHeaders,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An organization API key. Create one in Settings → API. Pasted into the explorer on /docs it stays in the page’s memory only and is forgotten on reload — it is never stored.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'code'],
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
                'The response’s `X-Request-Id`, repeated on a 429, on a 500, on a body-size 413 and on a URL-size 414 so a caller can quote it',
            },
            data: {
              type: 'object',
              properties: {
                retryAfterMs: {
                  type: 'number',
                  description: 'Wait in milliseconds for RATE_LIMITED',
                },
                providers: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'For CHAT_MODEL_AMBIGUOUS, the provider slugs that serve the model — name one as `providerSlug`',
                },
                lastMessageId: {
                  type: 'string',
                  description:
                    'For CHAT_TURN_NOT_RUNNING, the newest assistant message on the thread (once it has one) — the idle poll’s own disambiguation: equal to the `messageId` a 202 named means that turn already settled',
                },
                lastStatus: {
                  type: 'string',
                  enum: ['pending', 'complete', 'failed', 'cancelled'],
                  description:
                    'For CHAT_TURN_NOT_RUNNING, how `lastMessageId` settled (present with it)',
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
                    'For INVALID_BODY and INVALID_QUERY, every problem the schema found in the body or the query string; for INVALID_LIMIT and INVALID_CURSOR, the one parameter refused (`limit`, `cursor`); for AUTOMATION_INPUT_INVALID, every problem the automation’s inputs schema found in the run input (at most 20 either way), each naming the field and the reason; `error` repeats the first one',
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
                scope: {
                  type: 'string',
                  enum: ['user', 'team', 'org', 'apiKey'],
                  description:
                    'For BUDGET_EXCEEDED, whose cap is reached: the key holder’s own (`user`), one of their teams’ (`team`), the organization’s (`org`) or this API key’s (`apiKey`)',
                },
                period: {
                  type: 'string',
                  enum: ['daily', 'weekly', 'monthly'],
                  description:
                    'For BUDGET_EXCEEDED, what the cap counts over — a calendar day, ISO week or calendar month in UTC',
                },
                limitCode: {
                  type: 'string',
                  enum: ['TOKEN_LIMIT', 'COST_LIMIT', 'REQUEST_LIMIT'],
                  description:
                    'For BUDGET_EXCEEDED, which cap is reached: tokens, cost in cents, or requests',
                },
                used: {
                  type: 'number',
                  description:
                    'For BUDGET_EXCEEDED, the usage the cap measured this period, in its unit (tokens, cents or requests)',
                },
                limit: {
                  type: 'number',
                  description: 'For BUDGET_EXCEEDED, the cap, in the same unit',
                },
                resetsAt: {
                  type: 'number',
                  description:
                    'For BUDGET_EXCEEDED, when the period resets, in epoch milliseconds — `Retry-After` names the same wait in whole seconds',
                },
              },
            },
          },
        },

        // ── Documents ──
        RetryIndexingResult: {
          type: 'object',
          required: ['status'],
          description:
            'What a retry-indexing request did — the one answer the Hub ' +
            'document door and the project-file door share.',
          properties: {
            status: {
              type: 'string',
              enum: ['indexing', 'skipped'],
              description:
                '`indexing` — the blob was queued (an opt-out lifted); ' +
                '`skipped` — nothing was queued, `reason` says why',
            },
            reason: {
              type: 'string',
              enum: [
                'content-only',
                'untracked-blob',
                'unsupported',
                'in-progress',
              ],
              description:
                'Why indexing was skipped; absent when `status` is ' +
                '`indexing`. `content-only`: inline text never enters the ' +
                'search corpus (a Hub document without a file — never a ' +
                'project file); `untracked-blob`: the platform does not ' +
                'track the blob; `unsupported`: terminal — the platform ' +
                'cannot index these bytes and a retry reproduces the answer; ' +
                'the row’s `indexing.errorCode` names the cause ' +
                '(`unsupported_type`, `image_no_vision`, `empty`, ' +
                '`not_text`, `malformed`); `in-progress`: a fresh index job ' +
                'is already queued or running — poll `indexing` instead.',
            },
          },
        },
        Document: {
          type: 'object',
          required: [
            'id',
            'title',
            'contentHash',
            'createdBy',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            title: str,
            content: nullable({
              ...str,
              description:
                'Inline text; null for a file-backed document — read its bytes at `GET /api/v1/documents/{id}/content` — and in listings',
            }),
            fileId: nullable({ ...str, description: 'The blob reference' }),
            mimeType: nullable(str),
            extension: nullable(str),
            sourceProvider: nullable(str),
            teamIds: {
              type: 'array',
              items: str,
              description:
                'The audience: the teams that may read the document, by id; ' +
                'empty = organization-wide. Owners and admins read every ' +
                'team library regardless.',
            },
            teamId: nullable({
              ...str,
              deprecated: true,
              description:
                'The first team of `teamIds`, or null — the pre-1.17.0 ' +
                'single-team spelling; read `teamIds`',
            }),
            folderId: nullable(str),
            metadata: nullable(obj),
            contentHash: nullable({
              ...str,
              description:
                'SHA-256 (hex) of the stored bytes when the platform computed one — a knowledge entry’s content, a synced file; null otherwise. A column of its own, never a key in `metadata`',
            }),
            createdBy: str,
            createdAt: epochMs,
            updatedAt: epochMs,
            indexing: documentIndexing,
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
            metadata: freeFormObject('Free-form.'),
            teamIds: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 128 },
              maxItems: 64,
              description:
                'The audience: teams of this organization the key holder ' +
                'may assign (their own, unless they are an admin — ' +
                '`TEAM_ACCESS_DENIED`; an id that is not the organization’s ' +
                'is `TEAM_NOT_IN_ORG`). Omitted or empty = organization-wide. ' +
                'Inside a team folder the folder’s audience applies; naming ' +
                'a team outside it is `TEAM_INHERITED_FROM_FOLDER`.',
            },
            teamId: {
              type: 'string',
              maxLength: 128,
              description:
                'The single-team spelling of `teamIds` (still accepted)',
            },
            folderId: { type: 'string', maxLength: 64 },
          },
        },
        DocumentPatch: {
          type: 'object',
          additionalProperties: false,
          description:
            'Every field optional; null clears a nullable field. Applies only to Knowledge Hub documents. A patch that changes nothing writes nothing and leaves `updatedAt` alone.',
          properties: {
            expectedUpdatedAt: {
              type: 'integer',
              minimum: 0,
              description:
                'The `updatedAt` last read; the update applies only while the document still carries it, else 409 `DOCUMENT_STALE`',
            },
            title: {
              type: 'string',
              minLength: 1,
              maxLength: 512,
              description: 'Trimmed — a blank title is 400 `INVALID_BODY`',
            },
            content: nullable({ type: 'string', maxLength: 5_000_000 }),
            metadata: nullable(freeFormObject(MERGE_ON_PATCH)),
            mimeType: nullable({ type: 'string', maxLength: 255 }),
            extension: nullable({ type: 'string', maxLength: 32 }),
            sourceProvider: nullable({ type: 'string', maxLength: 64 }),
            teamIds: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 128 },
              maxItems: 64,
              description:
                'The audience, replaced whole (`[]` = organization-wide); ' +
                'the same rules as on create — inside a team folder the ' +
                'folder’s audience applies (`TEAM_INHERITED_FROM_FOLDER`)',
            },
            teamId: nullable({
              type: 'string',
              maxLength: 128,
              description:
                'The single-team spelling of `teamIds`; `null` clears',
            }),
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
            lastScannedAt: nullable({
              ...epochMs,
              description:
                'When the last scan ENDED, epoch ms; `null` until the first scan finishes — `status: "scanning"` is the in-flight signal, and the page counts move while it runs',
            }),
            status: nullable({
              type: 'string',
              enum: [...WEBSITE_STATUS_VALUES],
              description:
                'The SCAN’s lifecycle, not the content’s health: `scanning` — in flight (a registered site starts here); `active` — the last scan finished and stored at least one page; `error` — the last scan failed or stored no page (`metadata.lastSyncError` says why; a domain that does not resolve or an expired certificate lands here, never on `active`); `deleting` — mid removal. The obvious health check is `status === "active"`; `crawledPageCount - failedPageCount` says how many pages it holds.',
            }),
            pageCount: nullable({
              ...int,
              description:
                'Pages the crawler knows on this site, as of the last corpus → row sync (`metadata.lastStatusSyncAt` says when): during a scan the sync runs after discovery and after every stored batch, at each link’s end and at the scan’s end, and `POST /api/v1/websites/{id}/sync` forces one',
            }),
            crawledPageCount: nullable({
              ...int,
              description:
                'Pages the crawler ATTEMPTED in its scans so far — stored or not; a page whose every attempt failed counts here too (see `failedPageCount`), and `indexed` per page is on `GET /api/v1/websites/{id}/pages`. Stamped by the corpus → row sync like `pageCount`',
            }),
            failedPageCount: nullable({
              ...int,
              description:
                'Pages whose LAST attempt failed — each carries its `lastError` in the pages list; `null` until the next corpus → row sync stamps the row',
            }),
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
                'A public hostname or https URL (`docs.example.com`, ' +
                '`https://www.example.com/docs`); `http://` is refused ' +
                '(`WEBSITE_DOMAIN_INVALID`) — the crawler dials https only. ' +
                'The host is what is registered, spelled as given — `www.` ' +
                'is not stripped; case is folded, an internationalised name ' +
                'is stored in its punycode form and a trailing dot is ' +
                'dropped — and the `www.`/apex pair counts as one site ' +
                '(registering the sibling of a registered domain is the ' +
                '409). Loopback, ' +
                'link-local, private-network and cloud metadata hosts are ' +
                'refused (`WEBSITE_DOMAIN_NOT_CRAWLABLE`) — the crawler ' +
                'dials the target from inside the deployment’s network — ' +
                'and so is a bare IP address of any kind ' +
                '(`WEBSITE_DOMAIN_INVALID`): the crawler dials by host ' +
                'name and verifies the certificate against it, which no ' +
                'IP literal can present.',
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
            domain: {
              ...str,
              description:
                'Echo only: the stored value, as a client that sends the ' +
                'resource it read does (compared without regard to case ' +
                'or surrounding whitespace). Any other value is refused ' +
                'with 400 `WEBSITE_DOMAIN_IMMUTABLE`; the domain itself ' +
                'never changes.',
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
            'failCount',
            'lastError',
            'lastErrorKind',
            'lastErrorAt',
          ],
          properties: {
            url: str,
            title: nullable(str),
            wordCount: int,
            status: {
              type: 'string',
              enum: ['discovered', 'active'],
              description:
                '`discovered`: the crawler knows the URL but no fetch has stored it yet — never attempted, or every attempt failed (then `failCount` and `lastError` say so); `active`: a fetch stored the page at least once (`indexed` says whether its chunks are in the corpus). A DISCOVERED page the site answered 404/410 for leaves the listing, and so does one `robots.txt` has come to disallow; a LISTED one the site answers 404/410 for stays `discovered` with `http_error` naming the answer and is probed again next scan.',
            },
            contentHash: nullable(str),
            lastCrawledAt: nullable({
              ...epochMs,
              description:
                'Epoch milliseconds of the last ATTEMPT, stored or not',
            }),
            discoveredAt: nullable(epochMs),
            chunksCount: int,
            indexed: bool,
            failCount: {
              ...int,
              description:
                'Failed attempts in a row since the last stored fetch (or since the operator re-listed the URL); 0 when the last attempt stored the page. A discovered page stops being fetched after 5; a listed one never does',
            },
            lastError: nullable({
              ...str,
              description:
                'Why the last attempt stored nothing; `null` once a fetch stores the page again',
            }),
            lastErrorKind: nullable({
              type: 'string',
              enum: [...PAGE_FAILURE_KINDS],
              description:
                'The last failure’s kind: a fetch refusal (`insecure_public_http` — a redirect to a plaintext URL, a loopback included, is refused before it is dialed; `private_ip` — a redirect that resolves to a private, loopback or metadata address; `host_not_allowed` — a redirect off the registered site, which the crawler does not follow (it used to wear the `private_ip` label); `dns_failed`; `tls_error` — the certificate is expired, self-signed, untrusted or for another host, permanent until the operator fixes it; `timeout` — the page did not finish downloading within the 30-second budget, or the browser could not load it within 20 seconds; `response_too_large`; `redirect_limit_exceeded` — more than five redirects; `network_error` — any other connection failure, naming its cause; …), `http_error` (a 4xx/5xx other than 404/410; for a listed URL 404/410 too), `render_failed` (the sandboxed browser gave up), `extraction_failed` (a linked document no extractor could read), `unsupported_content` (the crawler looked and stored nothing: a content type it cannot turn into text — JSON, XML, an image, a binary download — the row stays `discovered` and its `failCount` counts the attempt), or `robots_noindex` (the origin answered `X-Robots-Tag: noindex` or carries `<meta name="robots" content="noindex">`, honoured — what an earlier scan stored is dropped); `null` when the last attempt succeeded. `lastError` is one line naming the cause, never a framework call log',
            }),
            lastErrorAt: nullable({
              ...epochMs,
              description: 'Epoch milliseconds of the last failure',
            }),
          },
        },
        WebsitePageList: {
          type: 'object',
          [PAGINATION]: 'offset',
          required: [
            'pages',
            'total',
            'offset',
            'hasMore',
            'isDone',
            'continueCursor',
          ],
          properties: {
            pages: { type: 'array', items: ref('WebsitePage') },
            total: int,
            offset: int,
            hasMore: bool,
            isDone: {
              type: 'boolean',
              description: 'True when the window reached the end (`!hasMore`)',
            },
            continueCursor: {
              type: 'string',
              description:
                'Pass back as `cursor` for the next window — the next ' +
                '`offset`, signed; empty when `isDone`',
            },
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
            score: {
              ...num,
              description:
                'The BM25 weight of the keyword match (ParadeDB `paradedb.score`): unbounded and comparable only within one response — never a cosine or a confidence, and never comparable across sites or calls. `0` on every hit when the knowledge database lacks ParadeDB and the door fell back to a substring match. This door has no dense leg; for `similarity` and `minSimilarity`, use `POST /api/v1/knowledge/search` with `corpus: "web"`.',
            },
          },
        },
        WebsiteSearchResults: {
          type: 'object',
          required: ['results', 'total'],
          properties: {
            results: { type: 'array', items: ref('WebsiteSearchHit') },
            total: {
              ...int,
              description:
                'How many chunks match, across the whole site — not the size ' +
                'of this answer: it can exceed `results.length`, which `limit` ' +
                'caps. This door returns only the first `limit` hits and has ' +
                'no pagination, so `total` is the count, not a cursor.',
            },
          },
        },

        // ── Conversations ──
        ConversationMirror: {
          type: 'object',
          required: [
            'conversationId',
            'externalId',
            'externalContactId',
            'contactId',
            'contactStatus',
            'version',
            'sourceDeleted',
            'status',
            'subject',
            'createdAt',
          ],
          properties: {
            conversationId: str,
            externalId: {
              ...str,
              description: 'The source conversation’s own id',
            },
            externalContactId: {
              ...str,
              description: 'The bound contact’s current external id',
            },
            contactId: {
              ...nullable(str),
              description:
                'The bound contact row — `GET /api/v1/contacts/{id}` takes it; null when none is linked',
            },
            contactStatus: {
              type: 'string',
              enum: ['active', 'trashed', 'missing'],
              description:
                '`trashed`: the contact was deleted and the mirror takes no more content until it is restored',
            },
            version: {
              ...int,
              description:
                'The stored source revision; -1 before the first snapshot applied',
            },
            sourceDeleted: {
              ...bool,
              description:
                'The source tore the mirror down with a `deleted` snapshot',
            },
            status: { ...str, description: 'The Inbox conversation’s status' },
            subject: nullable(str),
            createdAt: epochMs,
          },
        },
        ConversationDelivery: {
          type: 'object',
          description:
            'One native Inbox reply in a source’s delivery queue, as the listing shows it — never the claim token or the body',
          required: [
            'messageId',
            'conversationId',
            'externalId',
            'status',
            'attempts',
            'availableAt',
            'retryAt',
            'claimedAt',
            'failedAt',
            'lastErrorCode',
            'acknowledgedAt',
            'receiptId',
          ],
          additionalProperties: false,
          properties: {
            messageId: str,
            conversationId: str,
            externalId: str,
            status: {
              type: 'string',
              enum: [...API_DELIVERY_STATUSES],
              description:
                '`queued` — waiting (the undo window, a backoff, a lapsed lease); `leased` — a claim’s five-minute lease runs; `failed` — dead-lettered, awaiting a retry or a discard; `delivered` — acknowledged',
            },
            attempts: { ...int, description: 'Failure reports so far' },
            availableAt: {
              ...epochMs,
              description:
                'When the undo window closed and the reply became claimable',
            },
            retryAt: {
              ...epochMs,
              description:
                'When it next becomes claimable: the lease end while leased, the backoff end after a transient failure, in the past (or 0) when due now',
            },
            claimedAt: nullable({
              ...epochMs,
              description: 'The first claim; `null` until one',
            }),
            failedAt: nullable({
              ...epochMs,
              description: 'When it dead-lettered; `null` otherwise',
            }),
            lastErrorCode: nullable({
              ...str,
              description: 'The code of the last failure report',
            }),
            acknowledgedAt: nullable(epochMs),
            receiptId: nullable(str),
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
            'createdAt',
            'expiresAt',
            'lastUsedAt',
            'failureCount',
          ],
          properties: {
            id: str,
            domain: str,
            label: nullable(str),
            createdAt: {
              ...epochMs,
              description: 'When the session was imported',
            },
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
            imageUrl: nullable({
              ...str,
              format: 'uri',
              description:
                'An absolute image URL. App-uploaded images use a stable, organization-protected app URL and require an authorized app session to view; external image URLs keep their original access rules.',
            }),
            stock: nullable(num),
            price: nullable(num),
            currency: nullable(str),
            category: nullable(str),
            tags: strArray,
            status: nullable(str),
            translations: nullable({
              type: 'array',
              readOnly: true,
              description:
                'Reserved: per-language overrides of the catalog fields. ' +
                'Read-only and always null on this surface today — no ' +
                'input schema takes it and nothing writes it; a localized ' +
                'catalog is a later addition, and the field is declared so ' +
                'a client generated now keeps its shape then.',
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
            'Strings are trimmed, and a blank optional field — or one sent ' +
            'as `null` — reads as left out. Unknown keys are refused ' +
            '(`INVALID_BODY`).',
          additionalProperties: false,
          properties: nullableProperties(productInputProperties, ['name']),
        },
        ProductPatch: {
          type: 'object',
          description:
            'Every field optional. `null` clears any optional field, and a ' +
            'blank string reads as `null` (a blank `name` is refused); ' +
            '`metadata` merges per RFC 7396. Send `expectedUpdatedAt` from ' +
            'the last product read to update only that revision: a stale ' +
            'one answers 409 `PRODUCT_STALE` without changing any field, ' +
            'and a patch that changes nothing — an empty body, or every field ' +
            'already at its value — writes nothing and leaves `updatedAt` alone ' +
            '(the document rule), so it never spends another client’s ' +
            '`expectedUpdatedAt`; a write that changes something advances ' +
            '`updatedAt`, even within one millisecond.',
          additionalProperties: false,
          properties: {
            ...nullableProperties(productInputProperties, ['name']),
            expectedUpdatedAt: expectedUpdatedAtProperty,
          },
        },

        // ── The key holder ──
        Team: {
          type: 'object',
          required: ['id', 'name', 'member'],
          description:
            'One team of the organization: the `id` an audience names, ' +
            'the `name` the app shows for it, and whether the key holder ' +
            'is a member.',
          properties: {
            id: { ...str, description: 'The id `teamIds` and `teams` take' },
            name: { ...str, description: 'The team’s display name' },
            member: {
              ...bool,
              description:
                'Whether the key holder belongs to the team — an ' +
                'organization admin may assign any team, another role only ' +
                'the teams it is a member of',
            },
          },
        },
        Me: {
          type: 'object',
          required: [
            'user',
            'organization',
            'organizations',
            'capabilities',
            'key',
          ],
          additionalProperties: false,
          properties: {
            key: {
              type: 'object',
              nullable: true,
              description:
                'The API key this request authenticated with — keys are minted, rotated and revoked in the app (Settings > API > REST), never through this surface, so this is where an unattended caller sees its own expiry coming. `null` only when the key was revoked while the request was in flight.',
              required: ['id', 'name', 'expiresAt'],
              additionalProperties: false,
              properties: {
                id: str,
                name: {
                  ...nullable(str),
                  description: 'The name it was minted under',
                },
                expiresAt: {
                  ...nullable(epochMs),
                  description:
                    'When the key stops authenticating; `null` for a key minted to never expire',
                },
              },
            },
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
            capabilities: {
              type: 'object',
              description:
                'What this key may do — the gates a deployment knob, the role or an administrator’s grant decides, answered here so a client learns them before its first write rather than from a 403',
              required: [
                'deploymentEditor',
                'developer',
                'notificationExport',
                'actAs',
              ],
              additionalProperties: false,
              properties: {
                deploymentEditor: {
                  ...bool,
                  description:
                    'True when the key holder administers an organization and their e-mail is on the deployment editor allowlist (`TALE_DEPLOYMENT_CONFIG_ADMINS`) — the gate behind the browser-session pool’s import and delete, which answer 403 otherwise',
                },
                developer: {
                  ...bool,
                  description:
                    'True when the key holder’s role (owner, admin, developer) carries the developer capability — the gate on a live `POST …/runs`, `POST …/cancel`, `DELETE /runs/{runId}`, `PUT`/`DELETE …/triggers`, `DELETE /automations/{name}`, the project install and uninstall, and the MCP `save_automation`/`deploy_automation`/`set_trigger` tools; false there answers 403 `ROLE_FORBIDDEN`',
                },
                actAs: {
                  ...bool,
                  description:
                    'True when the key holder may name an `actor` — the verified member a relayed gesture is recorded for — on `POST …/runs/{runId}/asks/{askId}` and `POST …/tasks/{taskId}/review`: an organization owner or administrator by role, or any other member through a live `tale:rest.act-as` capability an administrator granted in the competence register (organization-scoped, optionally expiring, revocable, revoked with the membership); an `actor` sent without it answers 403 `ROLE_FORBIDDEN`',
                },
                notificationExport: {
                  ...bool,
                  description:
                    'True when the key holder may export members’ notifications through `GET /api/v1/notifications/sync` — an organization owner or administrator by role, or any other member through a live `tale:notifications.export` capability an administrator granted in the competence register (organization-scoped, optionally expiring, revocable, revoked with the membership); false there answers 403 `ROLE_FORBIDDEN`',
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
            email: nullable({ ...str, format: 'email' }),
            phone: nullable(str),
            externalId: nullable(str),
            source: str,
            locale: nullable(str),
            address: nullable(obj),
            tags: strArray,
            metadata: nullable(obj),
            notes: nullable(str),
            lifecycleStatus: {
              ...nullable(str),
              readOnly: true,
              description:
                'Read-only, set by the platform: null while the contact is ' +
                'live, `expired` once the organization’s retention policy ' +
                'has marked it for purge (such a contact still answers ' +
                'reads until the purge runs), `trashed` after a delete — ' +
                'a trashed contact is not served at all. No input schema ' +
                'takes it; a CRM pipeline stage belongs in `metadata`.',
            },
            createdAt: epochMs,
            updatedAt: epochMs,
          },
        },
        ContactInput: {
          type: 'object',
          description:
            'Unknown keys are refused (`INVALID_BODY`). Strings are trimmed, ' +
            'and a blank optional field — or one sent as `null` — reads as ' +
            'left out (a CSV-shaped row or a JSON export imports cleanly); ' +
            'the same body clears the field on a PATCH. A create needs at ' +
            'least one of `name`, `email` or `externalId` to file the ' +
            'contact under.',
          additionalProperties: false,
          properties: nullableProperties(contactInputProperties, ['source']),
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
              description:
                'Every row that did not land, by input index — a row the schema refused (`INVALID_BODY`, with its `issues`) beside a row the directory refused (a duplicate); the rest landed regardless.',
              items: {
                type: 'object',
                required: ['index', 'error', 'errorCode', 'contact'],
                properties: {
                  index: int,
                  error: str,
                  errorCode: {
                    type: 'string',
                    enum: [
                      'INVALID_BODY',
                      'CONTACT_DUPLICATE_EMAIL',
                      'CONTACT_DUPLICATE_EXTERNAL_ID',
                      'CONTACT_CREATE_FAILED',
                      'unknown',
                    ],
                    description:
                      '`INVALID_BODY` — the row failed the schema (`issues` names each field); the `CONTACT_*` codes are the single create’s own refusals.',
                  },
                  issues: {
                    type: 'array',
                    description:
                      'Present on an `INVALID_BODY` row: the field-named problems, paths relative to the row (`email`, not `contacts.3.email`).',
                    items: {
                      type: 'object',
                      required: ['path', 'message'],
                      properties: { path: str, message: str },
                    },
                  },
                  contact: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      'The row as sent — a refused row is echoed whatever shape it had.',
                  },
                },
              },
            },
          },
        },

        // ── Projects ──
        Project: {
          type: 'object',
          required: ['id', 'name', 'teamIds', 'createdAt', 'updatedAt'],
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
            teamIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'The audience: the teams that may see the project, by id; ' +
                'empty = organization-wide (every member). Owners and admins ' +
                'see every project regardless.',
            },
          },
        },
        ProjectFolder: {
          type: 'object',
          required: ['id', 'name', 'parentId'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            parentId: {
              type: 'string',
              nullable: true,
              description:
                'The folder this one sits in; null for a root folder',
            },
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
          required: [
            'uploadId',
            'url',
            'method',
            's3Ref',
            'expiresAt',
            'maxBytes',
          ],
          properties: {
            maxBytes: {
              type: 'integer',
              description:
                'The largest file this organization accepts for the ' +
                'declared type, in bytes — the platform ceiling ' +
                '(104,857,600, 100 MiB) or the organization’s lower cap; ' +
                'the bind refuses more (`FILE_TOO_LARGE` / ' +
                '`UPLOAD_POLICY_REJECTED`, `data.limitBytes`)',
            },
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
          required: ['id', 'createdAt', 'size'],
          properties: {
            id: { type: 'string' },
            fileName: nullable(str),
            folderId: nullable(str),
            mimeType: nullable({
              ...str,
              description:
                'Resolved from the file name’s extension at the bind — a declared `contentType` never stands in for it — and the `Content-Type` the download carries',
            }),
            size: nullable({
              ...int,
              description:
                'The landed bytes, from the blob’s metadata row — the size ' +
                'the upload policy judged; null when the platform does not ' +
                'track the blob',
            }),
            indexing: {
              ...documentIndexing,
              description:
                'Where the file stands in the search corpus — the vocabulary ' +
                '`Document.indexing` speaks. A file bound with the default ' +
                '`skipRagIndexing: true` reads `skipped` until someone indexes ' +
                'it (**Index now** on the project’s Knowledge tab, `POST ' +
                '…/files/{documentId}/retry-indexing`, or a bind with ' +
                '`skipRagIndexing: false`) and is not found by `POST ' +
                '…/knowledge/search` until then; absent when the platform ' +
                'does not track the blob.',
            },
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
              description:
                'Label names as stored — the spelling each label was ' +
                'first created with — in the order the task carries them ' +
                '(the order they were sent)',
            },
            archivedAt: {
              ...epochMs,
              description:
                'Epoch ms — present when the task is archived: the state ' +
                '`…/comments` and `…/start` refuse with 403 `TASK_ARCHIVED`. ' +
                'Set by `PATCH …/tasks/{taskId}` `{archived: true}` (the ' +
                'board’s own archive) and cleared by `{archived: false}`; ' +
                'read the state here before starting.',
            },
            createdAt: epochMs,
            updatedAt: epochMs,
          },
        },
        Actor: {
          type: 'object',
          additionalProperties: false,
          required: ['email'],
          description:
            'The verified member a machine caller acts FOR when it relays a person’s own gesture — named by e-mail, never by an id the caller made up. The door resolves the address against the organization’s members with the notification export’s rule: exactly one active, verified membership. Naming an actor at all needs `capabilities.actAs` from `/me`.',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              maxLength: 320,
              description:
                'The member’s e-mail address, compared without regard to case; it must be verified in Tale (403 `ACTOR_UNVERIFIED` otherwise), belong to exactly one active member of the organization (404 `ACTOR_NOT_FOUND`, 409 `ACTOR_AMBIGUOUS`, 403 `ACTOR_DISABLED`) and have access to the project the door acts in (403 `ACTOR_FORBIDDEN`)',
            },
            userId: {
              type: 'string',
              maxLength: 128,
              description:
                'The member’s id an earlier answer returned as `actorUserId`. Pin it: an address that has since moved to another account then answers 409 `ACTOR_REBOUND` instead of acting as its new holder',
            },
          },
        },
        QuestionSet: {
          type: 'object',
          required: ['questions'],
          description:
            'A structured question set an agent may ask instead of a plain sentence: up to four questions, each a choice among two to four labelled options; the person may also answer a question in their own words. Render each `question` with its `options`; the answer travels back as one string per question (see the answer door).',
          properties: {
            intro: {
              type: 'string',
              maxLength: 600,
              description:
                'The heading above the set — what the agent is trying to settle',
            },
            questions: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                required: ['id', 'question', 'options'],
                properties: {
                  id: { type: 'string', maxLength: 64 },
                  question: { type: 'string', maxLength: 300 },
                  header: {
                    type: 'string',
                    maxLength: 12,
                    description: 'A very short label for a progress chip',
                  },
                  multiSelect: bool,
                  options: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 4,
                    items: {
                      type: 'object',
                      required: ['label'],
                      properties: {
                        label: {
                          type: 'string',
                          maxLength: 80,
                          description:
                            'The option’s label — it IS the answer value',
                        },
                        description: { type: 'string', maxLength: 200 },
                        recommended: bool,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        PendingAsk: {
          type: 'object',
          required: [
            'askId',
            'runId',
            'nodeId',
            'question',
            'createdAt',
            'expiresAt',
          ],
          description:
            'The question a run is parked on (`waitingFor: "ask"`): what the agent asked, on which node, and until when an answer still resumes the run. Answer at `POST …/runs/{runId}/asks/{askId}`.',
          properties: {
            askId: str,
            runId: str,
            nodeId: {
              type: 'string',
              description: 'The agent node that asked',
            },
            question: {
              type: 'string',
              description:
                'The question as one sentence — always present, and the whole question when `questions` is absent',
            },
            questions: {
              allOf: [ref('QuestionSet')],
              description:
                'Present when the agent asked a structured set; `question` then summarises it',
            },
            createdAt: epochMs,
            expiresAt: {
              ...epochMs,
              description:
                'When the question stops accepting an answer — the run then fails with `failureCode: "ask_expired"`',
            },
            taskId: {
              type: 'string',
              description:
                'The task the run works on, whose timeline mirrors the answer; absent for a run without a task',
            },
          },
        },
        TaskReview: {
          type: 'object',
          required: [
            'approvalId',
            'taskId',
            'round',
            'requestedFor',
            'agentSlug',
            'runId',
            'createdAt',
          ],
          description:
            'A task’s open review: the gate a person decides at `POST …/tasks/{taskId}/review` or on the board.',
          properties: {
            approvalId: str,
            taskId: str,
            round: {
              type: 'integer',
              description:
                'Which review of this task this is; 0 when unrecorded',
            },
            requestedFor: {
              type: 'string',
              nullable: true,
              description: 'The reviewer the request named, if any',
            },
            agentSlug: {
              type: 'string',
              nullable: true,
              description:
                'The agent whose work is under review, if the park named one',
            },
            runId: {
              type: 'string',
              nullable: true,
              description:
                'The run whose settle parked the task in review, if any',
            },
            createdAt: epochMs,
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
              required: [
                'kind',
                'enabled',
                'lastFiredAt',
                'lastSkippedAt',
                'lastSkipReason',
              ],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['schedule', 'webhook', 'event'],
                },
                enabled: bool,
                ...triggerHealthProperties,
              },
              description:
                'What starts the automation, if a trigger is bound: its kind, ' +
                'whether it is switched on, and its health — the same ' +
                '`lastFiredAt`, `lastSkippedAt` and `lastSkipReason` that ' +
                '`GET …/triggers` reads, so one listing call finds every ' +
                'binding that is enabled and not firing (a `lastSkipReason` ' +
                'of `not_deployed` beside a null `deployedVersion` is a ' +
                'trigger waiting for a deploy); null when none is bound. ' +
                '`GET …/triggers` has the rest — the cron, the event, ' +
                '`lastRunId`.',
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
            'testsPassed',
            'testsCheckedAt',
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
                version: int,
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
                'The last run of this version’s tests: null — no verdict ' +
                '(a document without tests, or one never run); true — they ' +
                'passed, at the save that ran them (an MCP save of a ' +
                'document with tests) or at the deploy gate; false — they ' +
                'failed, at the save or at the gate, which persists its ' +
                'refusal. The latest verdict wins; `testsCheckedAt` says ' +
                'when it was reached.',
            }),
            testsCheckedAt: nullable({
              ...epochMs,
              description:
                'When `testsPassed` was last judged; null beside a null ' +
                'verdict, and null beside a verdict recorded before the ' +
                'time was kept (0.5.23 and earlier) — a known verdict of ' +
                'unknown age, never backfilled. Branch on `testsPassed` for ' +
                'the verdict and on this field for its freshness only.',
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
            createdBy: {
              type: 'string',
              description:
                'Who created the automation — the same vocabulary as ' +
                '`AutomationVersion.createdBy`, `system:provisioning` ' +
                'included for the built-in connector automations.',
            },
            createdAt: epochMs,
          },
        },
        AutomationVersion: {
          type: 'object',
          required: [
            'version',
            'testsPassed',
            'testsCheckedAt',
            'createdBy',
            'createdAt',
            'deployed',
          ],
          properties: {
            version: int,
            message: nullable(str),
            testsPassed: nullable({
              ...bool,
              description:
                'The last run of this version’s tests — null while none ' +
                'was recorded (no tests, or never run), else the save’s ' +
                'or the deploy gate’s verdict, the latest winning; a gate ' +
                'refusal persists its `false`',
            }),
            testsCheckedAt: nullable({
              ...epochMs,
              description:
                'When `testsPassed` was last judged; null beside a null ' +
                'verdict, and null beside a verdict recorded before the ' +
                'time was kept (0.5.23 and earlier) — a known verdict of ' +
                'unknown age, never backfilled. Branch on `testsPassed` for ' +
                'the verdict and on this field for its freshness only.',
            }),
            createdBy: {
              ...str,
              description:
                'Who saved the version: `api-key:<userId>` for a save through ' +
                'the MCP endpoint, the bare user id for a save from the ' +
                'product or its builder, or `system:provisioning` for a ' +
                'version the platform seeded when it provisioned the ' +
                'organization (the built-in connector automations). Split on ' +
                'the first `:`; a value without one is a user id.',
            },
            createdAt: epochMs,
            deployed: {
              ...bool,
              description: 'Whether this is the version live runs execute',
            },
          },
        },
        Trigger: {
          type: 'object',
          description:
            'The binding, and its health: `lastFiredAt` and `lastRunId` name ' +
            'the last run it started, `lastSkippedAt` and `lastSkipReason` ' +
            'the last time it came due and started nothing. A binding is ' +
            'alive when `lastFiredAt` keeps pace with its cadence; one whose ' +
            '`lastSkippedAt` is the newer stamp is coming due and not running ' +
            '— the reason says what to fix.',
          required: [
            'id',
            'name',
            'kind',
            'hasToken',
            'enabled',
            'lastFiredAt',
            'lastRunId',
            'lastSkippedAt',
            'lastSkipReason',
          ],
          properties: {
            id: {
              ...str,
              description:
                'The binding’s id — what a run’s `startedBy` (`trigger:<id>`) names',
            },
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
            lastRunId: {
              ...nullable(str),
              description:
                'The run `lastFiredAt` started; null until one has, and again ' +
                'once that run is deleted.',
            },
            ...triggerHealthProperties,
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
            'id',
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
            id: {
              ...str,
              description:
                'The run id — the name the full read uses; `runId` carries ' +
                'the same value',
            },
            runId: {
              ...str,
              description:
                'The run id again, under the name the start answered — one ' +
                'value under both names',
            },
            name: {
              ...str,
              description:
                'The automation the run was started as. Runs outlive their ' +
                'automation: after `DELETE /api/v1/automations/{name}` the ' +
                'rows stay listed and readable by id under this name, which ' +
                '`GET /api/v1/automations/{name}` then answers 404 for.',
            },
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
                'What started the run — one of four forms: `api-key:<userId>` ' +
                '(a start through this API or the MCP endpoint), ' +
                '`user:<userId>` (a start from the product), ' +
                '`trigger:<triggerId>` (a schedule, webhook or event — the id ' +
                'the trigger read answers), or a bare user id on runs the ' +
                'in-product builder recorded before it prefixed them. Split ' +
                'on the first `:`; treat a value without one as a user id.',
            },
            detail: {
              ...str,
              description:
                'The failure or wait reason, when the run has one. While ' +
                '`waiting` it names the park: `approval:<approvalId>`, ' +
                '`agent:<nodeId>` or `repeat:<nodeId>` — `waitingFor` is the ' +
                'field to branch on; when `failed`, the failure sentence, ' +
                'and `failureCode` the stable cause — the sentence is not ' +
                'contractual.',
            },
            failureCode: {
              type: 'string',
              enum: [...RUN_FAILURE_CODES],
              description:
                'Why a `failed` run failed — present only with ' +
                '`status: "failed"` on a run that failed on a build that ' +
                'records it. See `Run.failureCode` for the vocabulary and ' +
                'which codes are worth a retry.',
            },
            waitingFor: {
              type: 'string',
              enum: ['approval', 'ask', 'agent', 'repeat'],
              description:
                'Present only while `status` is `waiting`: what the run is ' +
                'parked on. `approval` — a person’s decision on a gate; `ask` ' +
                '— a question a person has to answer; `agent` — an agent turn ' +
                'still running, no one to page; `repeat` — a node polling ' +
                'until its `repeatUntil` condition holds, no one to page. ' +
                '"Runs that need a human" is `waitingFor` in (`approval`, ' +
                '`ask`), never `status=waiting` alone.',
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
          properties: runProperties,
        },
        RunProjection: {
          type: 'object',
          description:
            'A run read with `?fields=`: exactly the keys of `Run` the ' +
            'query named, no others — none is required, since the caller ' +
            'chose them.',
          properties: runProperties,
          additionalProperties: false,
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
            'matchedLegs',
            'similarity',
            'keywordScore',
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
                'The surviving leg copy’s own relevance score — BM25 when the keyword leg found the passage, else its cosine; scales differ per leg, so read `keywordScore` and `similarity`, which name theirs',
            },
            fusedScore: {
              ...num,
              minimum: 0,
              maximum: 1,
              description:
                'The rank-fusion order key the hits are sorted by: Σ 1/(60+rank) over the legs that ranked the passage, divided by the best score possible given the legs that contributed candidates to THIS response (`diagnostics.legs`) — so the same passage reads 1.0 when both document legs ranked it first in a two-leg search and 0.667 when a third leg (a web neighbour) contributed too. A RANK — comparable only within one response, never a confidence, and not stable across searches. Threshold on `similarity` instead',
            },
            legs: {
              ...int,
              minimum: 1,
              maximum: 2,
              description:
                'How many retrieval legs of the corpus found the passage: 2 when the keyword and the vector leg agreed, 1 when only one did',
            },
            matchedLegs: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'documents:keyword',
                  'documents:dense',
                  'web:keyword',
                  'web:dense',
                ],
              },
              description:
                'Which legs ranked the passage — the leg that produced `score` is the first one',
            },
            similarity: {
              ...nullable(num),
              minimum: 0,
              maximum: 1,
              description:
                'The dense (vector) leg’s cosine similarity when it ranked the passage, on the embedding model’s own 0..1 scale — the number to threshold the vector leg on, and what `minSimilarity` floors; null when only the keyword leg found it — keep such a hit, its `keywordScore` is the evidence',
            },
            keywordScore: {
              ...nullable(num),
              description:
                'The keyword leg’s BM25 weight when it ranked the passage (unbounded, relative to the corpus); null when only the vector leg found it',
            },
            rerankScore: {
              ...num,
              description:
                'Reserved for a deployment that installs a reranker — none ships, so it is never present today',
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
                'In fused order (`fusedScore` descending), one passage per repeated text; at equal `fusedScore` a passage the keyword leg ranked precedes one only the vector leg found (an exact term is stronger evidence than a nearest neighbour), then the lower row identity. Every candidate is checked against its live document BEFORE fusion, so a refused one never holds a rank, and the page is cut last — `limit` never costs a readable hit',
            },
            diagnostics: {
              type: 'object',
              required: [
                'bm25',
                'dense',
                'reranked',
                'cached',
                'admitted',
                'legs',
              ],
              properties: {
                bm25: {
                  ...bool,
                  description:
                    'False when the keyword index was unavailable and only the vector leg ran',
                },
                dense: {
                  ...bool,
                  description:
                    'False when the corpus could not serve the vector leg (its table, or a column this release selects, is missing) and only the keyword leg ran — the twin of `bm25`, so a dead leg is never silent',
                },
                reranked: {
                  ...bool,
                  description:
                    'Reserved for a deployment that installs a reranker — none ships, so this is always false',
                },
                cached: {
                  ...bool,
                  description:
                    'Reserved for a deployment that installs a semantic cache — none ships, so this is always false',
                },
                admitted: {
                  ...int,
                  minimum: 0,
                  description:
                    'Candidates that passed the live-document check and were fused, before repeated passages were dropped and the page was cut',
                },
                legs: {
                  type: 'object',
                  additionalProperties: true,
                  description:
                    'Every leg that RAN, keyed by leg (`documents:keyword`, `documents:dense`, `web:keyword`, `web:dense`), with how many admitted candidates it contributed to fusion — counts after the live-document check, `0` when it ran and nothing survived that check or the `minSimilarity` floor. A leg that could not run is absent and named by `bm25` / `dense`',
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
            harness: {
              ...str,
              description:
                'The sandbox harness a thread the app started runs on (`claude-code`, …) — present only on such a thread; the direct threads this surface creates never carry it',
            },
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
            isShared: {
              ...bool,
              description:
                'Whether the owner’s share link for the thread is live — present once the thread has been shared or unshared in the app, absent on one that never was',
            },
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
            label: {
              ...str,
              description:
                'A display name for a picker (`DeepSeek V4 Flash`, `GLM 5v Turbo`) — derived from the id where the catalog publishes none; never send it as `model`',
            },
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
              description:
                'The largest reply the model produces, in tokens. Absent when the catalog declares no ceiling — then no `maxOutputTokens` check applies to a send.',
            },
            capabilities: {
              type: 'object',
              required: ['tools', 'vision', 'reasoning'],
              additionalProperties: false,
              properties: {
                tools: { ...bool, description: 'Accepts function tools' },
                vision: {
                  ...bool,
                  description:
                    'Reads images — a fact about the model, not an input this surface offers: the REST send is text only (`content`), so `vision` matters here for a thread the app continues with image attachments, whose `attachment` parts the model then sees. An image pasted into `content` as a data URI is read as text.',
                },
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
                'The catalog’s capability tags (`chat`, `vision`, …) — an open, additive vocabulary describing the model, like `capabilities`; `vision` does not add an image input to the text-only REST send',
            },
            default: {
              ...bool,
              description:
                'Present and true on the organization’s default pick for this key holder, when one is configured and accessible',
            },
          },
        },
        TextPart: {
          type: 'object',
          required: ['type', 'text'],
          properties: {
            type: { type: 'string', enum: ['text'] },
            text: str,
          },
        },
        ReasoningPart: {
          type: 'object',
          required: ['type', 'text'],
          description:
            'The model’s reasoning ahead of its reply — display-only, never replayed to the model; it may quote the assistant’s own instructions verbatim, so it is not safe to render as the answer.',
          properties: {
            type: { type: 'string', enum: ['reasoning'] },
            text: str,
          },
        },
        AttachmentPart: {
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
        ToolCallPart: {
          type: 'object',
          required: ['type', 'callId', 'capabilityId', 'input'],
          properties: {
            type: { type: 'string', enum: ['tool-call'] },
            callId: str,
            capabilityId: str,
            input: {},
          },
        },
        ToolResultPart: {
          type: 'object',
          required: ['type', 'callId', 'capabilityId', 'output', 'structured'],
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
        ApprovalPart: {
          type: 'object',
          required: ['type', 'approvalId', 'question'],
          properties: {
            type: { type: 'string', enum: ['approval'] },
            approvalId: str,
            question: str,
            decision: { type: 'string', enum: ['approved', 'rejected'] },
          },
        },
        HumanInputPart: {
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
        MessagePart: {
          description:
            'One ordered piece of a message, discriminated by `type`: the `mapping` names the schema each kind validates against (`TextPart` … `HumanInputPart`), so a discriminator-honouring validator resolves every part. The kinds listed are the vocabulary as of this version; the set is additive, so a client renders a kind it does not know as opaque.',
          discriminator: {
            propertyName: 'type',
            mapping: {
              text: '#/components/schemas/TextPart',
              reasoning: '#/components/schemas/ReasoningPart',
              attachment: '#/components/schemas/AttachmentPart',
              'tool-call': '#/components/schemas/ToolCallPart',
              'tool-result': '#/components/schemas/ToolResultPart',
              approval: '#/components/schemas/ApprovalPart',
              'human-input': '#/components/schemas/HumanInputPart',
            },
          },
          oneOf: [
            ref('TextPart'),
            ref('ReasoningPart'),
            ref('AttachmentPart'),
            ref('ToolCallPart'),
            ref('ToolResultPart'),
            ref('ApprovalPart'),
            ref('HumanInputPart'),
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
                '`pending` is the placeholder a running turn fills in (the row GET …/generation names as messageId); `complete` is a settled reply — a reply the output cap cut short included, so read `finishReason` for that; `cancelled` is a turn stopped through DELETE …/generation — `parts` and `usage` hold what had streamed; `failed` carries `error`.',
            },
            finishReason: {
              type: 'string',
              enum: [...TURN_FINISH_REASONS],
              description:
                'Why the turn stopped, on a settled assistant message, in one vocabulary over every provider: `stop` (a natural end), `length` (the `maxOutputTokens` cap or the model’s own ceiling cut a round of this reply short — the final text, or, in a tool-calling turn, the tool calls of an earlier round: every call of that round is withheld, its tool-result reads `status: "invalid_args"` — the message saying whether its arguments were cut or complete — and the final text may be whole; the status still reads `complete`), `tool-calls` (the final round ended on tool calls), `content-filter` (the provider’s or the platform’s filter), `cancelled` (stopped through DELETE …/generation), `other` (a reason the provider named that has no bucket here). Absent when the provider reported none.',
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
                'Stable chat error classification when available. `credit_exhausted` and `model_not_entitled` mean the provider account, not the request; neither is `rate_limited`. `budget_exceeded` means a budget cap that binds the key holder was reached after the send was accepted, so the turn never ran; a send made once a cap is reached is refused up front with 429 `BUDGET_EXCEEDED`.',
            },
            usage: {
              type: 'object',
              additionalProperties: false,
              description:
                'The token counters the finished turn recorded and the catalog cost estimate stamped beside them; absent until the turn settles, and absent on a turn that failed before the provider reported counts. Counts are the provider’s own unless `estimated` is present.',
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
                    'The share of `outputTokens` spent thinking before the reply — absent when the provider reported no count (a `0` is a reported zero)',
                },
                costEstimateCents: {
                  ...num,
                  minimum: 0,
                  description:
                    'The turn’s cost in US cents (fractional) from the catalog price the organization ledger also books — the same figure as the ledger; absent when the catalog publishes no price for the model. Cached input is priced at the input rate, so on a cached turn the figure is an upper bound; estimated when the provider’s count was lost (`estimated`).',
                },
                estimated: {
                  ...bool,
                  enum: [true],
                  description:
                    'Present when the counts are the platform’s own estimate — the provider’s usage frame was lost (a cancelled turn, typically) or never sent — so the cost is an estimate too',
                },
                stepLimitHit: {
                  ...bool,
                  enum: [true],
                  description:
                    'Present when the tool loop spent its whole round budget and the final round had tools withheld — the answer may have been forced',
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
          required: [
            'slug',
            'description',
            'visibility',
            'canEdit',
            'etag',
            'updatedAt',
          ],
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
            'etag',
            'updatedAt',
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
            source: {
              type: 'string',
              enum: ['chat', 'manual', 'api'],
              description:
                'The lane the fact came through: `chat` (the assistant captured it), `manual` (typed into the Knowledge entries form) or `api` (this door — a create or supersede over REST)',
            },
            documentId: {
              ...str,
              description:
                'The indexed Hub document the topic’s versions are stored in (`sourceProvider: knowledge`): `GET /api/v1/documents/{id}` reads its metadata and `indexing` state, `GET /api/v1/documents/{id}/content` its bytes — the active version’s text. A direct delete or content edit of that document is refused — this entry is the way to change it',
            },
            supersededBy: {
              ...str,
              description: 'The row that replaced this one',
            },
            supersededAt: {
              ...epochMs,
              description:
                'When this row was replaced — present on a superseded row only',
            },
            createdBy: str,
            createdAt: epochMs,
          },
        },
        KnowledgeEntryCreated: {
          type: 'object',
          required: ['id', 'documentId'],
          properties: {
            id: {
              ...str,
              description:
                'The entry row written — or, on an update whose body repeats the active row, that row',
            },
            documentId: {
              ...str,
              description:
                'The Hub document the entry is stored in — poll `GET /api/v1/documents/{documentId}` for `indexing`',
            },
          },
        },
      },
    },
  };
}
