import { estimateJsonTokens } from '../../../lib/chat/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';

/**
 * The two vendor wires the model endpoints for API keys speak, and what they
 * share: where each lives, how a refusal is said in each, and the facts the
 * door reads off a request before it relays it.
 *
 *  - `openai` — OpenAI Chat Completions under `/api/v1/openai`
 *    (`POST /chat/completions`, `GET /models`). An OpenAI SDK takes the base
 *    URL `https://<host>/api/v1/openai` and appends the path itself.
 *  - `anthropic` — Anthropic Messages under `/api/v1/anthropic`
 *    (`POST /v1/messages`). An Anthropic SDK or Claude Code takes the base
 *    URL `https://<host>/api/v1/anthropic` and appends `/v1/messages`.
 *
 * Every answer on these paths — a refusal of the REST door's own included —
 * is in the wire's error shape, so a vendor SDK reads it as the vendor's own:
 * OpenAI `{error: {message, type, code, param}}`, Anthropic
 * `{type: "error", error: {type, message, code}, request_id}`. `code` is the
 * REST door's stable refusal code (`MODEL_API_DISABLED`, `BUDGET_EXCEEDED`,
 * …) — standard on the OpenAI shape, an addition on Anthropic's.
 */

export type ModelApiWire = 'openai' | 'anthropic';

/** The path each wire lives under on the REST door. */
export const MODEL_API_WIRE_PATHS: Readonly<Record<ModelApiWire, string>> = {
  openai: '/api/v1/openai',
  anthropic: '/api/v1/anthropic',
};

/** The wire a request path belongs to, or null for any other path. */
export function modelApiWireOf(path: string): ModelApiWire | null {
  for (const wire of ['openai', 'anthropic'] as const) {
    const prefix = MODEL_API_WIRE_PATHS[wire];
    if (path === prefix || path.startsWith(`${prefix}/`)) return wire;
  }
  return null;
}

/** Whether a path the REST door routes belongs to the model endpoints — as
 * the door's own middleware sees it, with or without the `/api/v1` mount. */
export function isModelApiDoorPath(path: string): boolean {
  const relative = path.startsWith('/api/v1/')
    ? path.slice('/api/v1'.length)
    : path;
  return /^\/(?:openai|anthropic)(?:\/|$)/.test(relative);
}

/** A refusal the door answers in the wire's shape. */
export class ModelApiRefusal extends Error {
  readonly status: number;
  readonly code: string;
  /** The request field the refusal is about (`messages.2.content.0`), for
   * the OpenAI shape's `param`. */
  readonly param: string | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { param?: string; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ModelApiRefusal';
    this.status = status;
    this.code = code;
    this.param = options.param;
    this.headers = options.headers ?? {};
  }
}

/** A body field the wire does not accept — 400 `INVALID_BODY`, naming it. */
export function invalidBody(param: string, message: string): ModelApiRefusal {
  return new ModelApiRefusal(
    400,
    'INVALID_BODY',
    param === '' ? message : `${param}: ${message}`,
    { param },
  );
}

/** The OpenAI `error.type` for a status — informational, since the SDKs
 * branch on the status, but kept to the vocabulary OpenAI-compatible servers
 * use. A spent budget is `insufficient_quota`, OpenAI's own word for it. */
function openAiErrorType(status: number, code: string): string {
  if (code === 'BUDGET_EXCEEDED') return 'insufficient_quota';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

/** Anthropic's `error.type` for a status, as its API documents them. */
function anthropicErrorType(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request_error';
    case 401:
      return 'authentication_error';
    case 402:
      return 'billing_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 413:
      return 'request_too_large';
    case 429:
      return 'rate_limit_error';
    case 529:
      return 'overloaded_error';
    default:
      return status >= 500 ? 'api_error' : 'invalid_request_error';
  }
}

export interface WireError {
  status: number;
  code: string;
  message: string;
  param?: string | undefined;
  /** The vendor's own `error.type`, when the refusal came from upstream and
   * named one — kept rather than re-derived from the status. */
  type?: string;
}

/** A refusal as the wire's error body. */
export function wireErrorBody(
  wire: ModelApiWire,
  error: WireError,
  requestId?: string,
): Record<string, unknown> {
  if (wire === 'openai') {
    return {
      error: {
        message: error.message,
        type: error.type ?? openAiErrorType(error.status, error.code),
        param: error.param ?? null,
        code: error.code,
      },
    };
  }
  return {
    type: 'error',
    error: {
      type: error.type ?? anthropicErrorType(error.status),
      message: error.message,
      code: error.code,
    },
    ...(requestId !== undefined ? { request_id: requestId } : {}),
  };
}

/** The headers every answer on a wire carries beside the door's own: the
 * Anthropic SDKs read the request id from `request-id`. */
export function wireHeaders(
  wire: ModelApiWire,
  requestId: string | undefined,
): Record<string, string> {
  return wire === 'anthropic' && requestId !== undefined
    ? { 'request-id': requestId }
    : {};
}

/** A refusal as a finished response in the wire's shape. `x-should-retry:
 * false` on a spent budget: the vendor SDKs retry a 429 on their own, and
 * the cap only moves when its period rolls over. */
export function wireErrorResponse(
  wire: ModelApiWire,
  refusal: ModelApiRefusal,
  requestId?: string,
): Response {
  const headers = new Headers({
    'content-type': 'application/json',
    ...wireHeaders(wire, requestId),
    ...refusal.headers,
  });
  if (refusal.code === 'BUDGET_EXCEEDED')
    headers.set('x-should-retry', 'false');
  return new Response(
    JSON.stringify(
      wireErrorBody(
        wire,
        {
          status: refusal.status,
          code: refusal.code,
          message: refusal.message,
          param: refusal.param,
        },
        requestId,
      ),
    ),
    { status: refusal.status, headers },
  );
}

/**
 * One stretch of text in a request that the organization's input guardrails
 * judge — a system instruction or a person's message part — readable and,
 * when a guardrail masks it, rewritable in place in the body the door
 * relays.
 */
export interface TextSegment {
  readonly role: 'system' | 'user';
  read(): string;
  write(text: string): void;
}

/** What the door reads off a request before it relays it. */
export interface WireRequest {
  /** The parsed body; the door relays it after rewriting `model`, the
   * masked text and the gateway-only fields. */
  body: Record<string, unknown>;
  /** The model id the caller named. */
  model: string;
  stream: boolean;
  /** The output cap the caller asked for, when it named one. */
  maxOutputTokens?: number;
  /** How many answers the request asks for (OpenAI's `n`); each one may run
   * to the output cap, so the hold counts the cap that many times. */
  choiceCount: number;
  /** Images anywhere the wire lets them ride (a message, a tool result). */
  imageCount: number;
  /** Documents (PDF, text) the request carries — relayed, never scanned. */
  documentCount: number;
  /** Whether the request offers the model tools. */
  offersTools: boolean;
  /** The system and user text the input guardrails judge. */
  segments: TextSegment[];
}

/** What one image costs a prompt, at the most a vendor charges for one
 * (Anthropic's ~1,600 tokens for a 1.15-megapixel image) — the hold is a
 * worst case, and pixels are not text to count. */
const IMAGE_PROMPT_TOKENS = 1_600;
/** A document's share of the hold when its pages cannot be counted here. */
const DOCUMENT_PROMPT_TOKENS = 3_000;

/** A string long enough to be inline media rather than text: a data URL, or
 * base64 past a few KiB (image and document bytes ride as either). */
function isInlineMedia(value: string): boolean {
  if (value.startsWith('data:') && value.length > 256) return true;
  return value.length > 4_096 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

/** The body with inline media emptied — what its text weighs. */
function withoutInlineMedia(value: unknown): unknown {
  if (typeof value === 'string') return isInlineMedia(value) ? '' : value;
  if (Array.isArray(value)) return value.map(withoutInlineMedia);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        withoutInlineMedia(entry),
      ]),
    );
  }
  return value;
}

/** The prompt a request carries, in tokens, estimated the way the chat
 * lane sizes its hold: its text at the JSON rate (messages, system, tool
 * definitions), each image and document at a fixed worst case. */
export function estimatePromptTokens(request: WireRequest): number {
  return (
    estimateJsonTokens(withoutInlineMedia(request.body)) +
    request.imageCount * IMAGE_PROMPT_TOKENS +
    request.documentCount * DOCUMENT_PROMPT_TOKENS
  );
}

/** Body fields the gateway reads as its own instructions, never relayed:
 * `fallbacks` would reroute the call to models the caller never named and
 * the key was never scoped to. */
export const GATEWAY_ONLY_FIELDS = ['fallbacks'] as const;

/** A URL an image or document may ride as: inline (`data:`) or a public
 * `https:` address the provider fetches itself. */
export function isRelayableMediaUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('https://');
}
