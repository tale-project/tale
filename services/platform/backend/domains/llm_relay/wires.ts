/**
 * The request shapes the model relay answers, and how each one is told that
 * a request was refused (tale-project/tale#4942).
 *
 * A managed harness speaks one of four wires to the relay, at the paths the
 * sandbox LLM gateway served them, so a harness's settings mean the same on
 * either:
 *
 *  - `anthropic`: Anthropic Messages, `/anthropic/v1/messages` (Claude Code,
 *    the vision tools);
 *  - `openai-chat`: OpenAI Chat Completions, `/openai/v1/chat/completions`
 *    (pi, OpenCode, Hermes, OpenClaw, Qwen Code);
 *  - `openai-responses`: the OpenAI Responses API, `/openai/v1/responses`
 *    (Codex);
 *  - `genai`: Google GenAI, `/genai/v1beta/models/<model>:<method>` (Gemini
 *    CLI).
 *
 * A connector serves Anthropic Messages or OpenAI Chat Completions, and the
 * OpenAI Responses API where its upstream has one ({@link UpstreamWire}).
 */

export type RelayWire =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'genai';

/** The wires an upstream is called on. */
export type UpstreamWire = 'anthropic' | 'openai-chat' | 'openai-responses';

/** What a request to the relay asks for. */
export type RelayRoute =
  | {
      kind: 'generate';
      wire: RelayWire;
      /** GenAI names the model and the streaming in the path. */
      path?: { model: string; stream: boolean };
    }
  | {
      kind: 'count-tokens';
      wire: 'anthropic' | 'genai';
      path?: { model: string };
    }
  | { kind: 'models' }
  | { kind: 'health' };

const GENAI_PATH =
  /^\/genai\/v1(?:beta)?\/models\/(.+):(generateContent|streamGenerateContent|countTokens)$/;

/** The route a request asks for, or null for anything the relay does not
 * serve. Only these paths exist: the relay is no general proxy. */
export function routeOf(method: string, pathname: string): RelayRoute | null {
  if (method === 'GET') {
    if (pathname === '/health') return { kind: 'health' };
    if (pathname === '/openai/v1/models') return { kind: 'models' };
    return null;
  }
  if (method !== 'POST') return null;
  switch (pathname) {
    case '/anthropic/v1/messages':
      return { kind: 'generate', wire: 'anthropic' };
    case '/anthropic/v1/messages/count_tokens':
      return { kind: 'count-tokens', wire: 'anthropic' };
    case '/openai/v1/chat/completions':
      return { kind: 'generate', wire: 'openai-chat' };
    case '/openai/v1/responses':
      return { kind: 'generate', wire: 'openai-responses' };
  }
  const genai = GENAI_PATH.exec(pathname);
  if (genai === null) return null;
  const [, encoded = '', method_ = ''] = genai;
  let model: string;
  try {
    model = decodeURIComponent(encoded);
  } catch (error) {
    console.warn(
      `[llm-relay] a GenAI path names an undecodable model: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  if (method_ === 'countTokens') {
    return { kind: 'count-tokens', wire: 'genai', path: { model } };
  }
  return {
    kind: 'generate',
    wire: 'genai',
    path: { model, stream: method_ === 'streamGenerateContent' },
  };
}

/**
 * The credential a request presents, however its client sends it: a bearer
 * token (Claude Code, the OpenAI clients, the vision tools), `x-api-key` (an
 * Anthropic client given an API key), `x-goog-api-key` or `?key=` (the
 * Google GenAI clients). Null when the request carries none.
 */
export function presentedCredential(
  headers: Headers,
  search: URLSearchParams,
): string | null {
  const authorization = headers.get('authorization')?.trim();
  if (authorization !== undefined && authorization !== '') {
    const bearer = /^bearer\s+(\S+)$/i.exec(authorization);
    return bearer?.[1] ?? null;
  }
  for (const name of ['x-api-key', 'x-goog-api-key']) {
    const value = headers.get(name)?.trim();
    if (value !== undefined && value !== '') return value;
  }
  const key = search.get('key')?.trim();
  return key !== undefined && key !== '' ? key : null;
}

/** The kind of a refusal, which each wire spells its own way. */
export type RelayErrorKind =
  | 'invalid_request'
  | 'authentication'
  | 'permission'
  | 'not_found'
  | 'budget'
  | 'rate_limit'
  | 'too_large'
  | 'upstream'
  | 'overloaded'
  | 'timeout';

const STATUS: Readonly<Record<RelayErrorKind, number>> = {
  invalid_request: 400,
  authentication: 401,
  // 402 is what a harness reads as a spent allowance: its turn settles as
  // `budget_exceeded`, which no retry gate re-kicks (external_turn_shared.ts).
  budget: 402,
  permission: 403,
  not_found: 404,
  too_large: 413,
  rate_limit: 429,
  upstream: 502,
  overloaded: 503,
  timeout: 504,
};

const ANTHROPIC_TYPE: Readonly<Record<RelayErrorKind, string>> = {
  invalid_request: 'invalid_request_error',
  authentication: 'authentication_error',
  budget: 'billing_error',
  permission: 'permission_error',
  not_found: 'not_found_error',
  too_large: 'request_too_large',
  rate_limit: 'rate_limit_error',
  upstream: 'api_error',
  overloaded: 'overloaded_error',
  timeout: 'timeout_error',
};

const OPENAI_TYPE: Readonly<Record<RelayErrorKind, string>> = {
  invalid_request: 'invalid_request_error',
  authentication: 'authentication_error',
  budget: 'insufficient_quota',
  permission: 'permission_error',
  not_found: 'not_found_error',
  too_large: 'invalid_request_error',
  rate_limit: 'rate_limit_error',
  upstream: 'api_error',
  overloaded: 'server_error',
  timeout: 'timeout_error',
};

const GENAI_STATUS: Readonly<Record<RelayErrorKind, string>> = {
  invalid_request: 'INVALID_ARGUMENT',
  authentication: 'UNAUTHENTICATED',
  budget: 'RESOURCE_EXHAUSTED',
  permission: 'PERMISSION_DENIED',
  not_found: 'NOT_FOUND',
  too_large: 'INVALID_ARGUMENT',
  rate_limit: 'RESOURCE_EXHAUSTED',
  upstream: 'UNAVAILABLE',
  overloaded: 'UNAVAILABLE',
  timeout: 'DEADLINE_EXCEEDED',
};

/** The status a refusal of this kind answers with. */
export function statusOf(kind: RelayErrorKind): number {
  return STATUS[kind];
}

/** A refusal's body in the wire's own error shape, so the client shows its
 * message the way it shows the vendor's. */
export function errorBody(
  wire: RelayWire,
  kind: RelayErrorKind,
  message: string,
  status: number = STATUS[kind],
): Record<string, unknown> {
  switch (wire) {
    case 'anthropic':
      return { type: 'error', error: { type: ANTHROPIC_TYPE[kind], message } };
    case 'genai':
      return {
        error: { code: status, message, status: GENAI_STATUS[kind] },
      };
    case 'openai-chat':
    case 'openai-responses':
      return {
        error: { message, type: OPENAI_TYPE[kind], param: null, code: null },
      };
    default: {
      const _exhaustive: never = wire;
      return _exhaustive;
    }
  }
}

/** A refusal as a response, in the wire's error shape. */
export function errorResponse(
  wire: RelayWire,
  kind: RelayErrorKind,
  message: string,
  status: number = STATUS[kind],
): Response {
  return Response.json(errorBody(wire, kind, message, status), {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
