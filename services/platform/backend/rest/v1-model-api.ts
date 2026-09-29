import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import {
  listModelApiModelsForCaller,
  type ModelApiRequestContext,
  relayModelApiRequest,
} from '../domains/model_api/door.ts';
import {
  invalidBody,
  ModelApiRefusal,
  type ModelApiWire,
  wireErrorResponse,
  wireHeaders,
} from '../domains/model_api/wire.ts';
import { requestIdOf } from '../error-reporting.ts';
import {
  INVALID_JSON,
  readJsonBody,
  restApiKeyId,
  type RestEnv,
} from './shared.ts';

/**
 * The model endpoints for API keys — the organization's approved models,
 * callable from a key holder's own tools over the two vendor wires those
 * tools already speak:
 *
 *  - `POST /api/v1/openai/chat/completions` and `GET /api/v1/openai/models`
 *    — OpenAI Chat Completions (base URL `https://<host>/api/v1/openai`);
 *  - `POST /api/v1/anthropic/v1/messages` — Anthropic Messages (base URL
 *    `https://<host>/api/v1/anthropic`, which Claude Code takes as
 *    `ANTHROPIC_BASE_URL`).
 *
 * They sit inside the REST door: the same Bearer key (never `x-api-key`),
 * `X-Organization-Slug`, `rest:api` budget and request id. What they add is
 * the domain in `domains/model_api/door.ts` — the organization's switch, the
 * holder's right, model access, the input guardrails, the budget hold and
 * the gateway key — and the wire's own error shape on every refusal (the
 * door's own refusals are reshaped by `modelApiWireErrors`, lib/model-api-
 * wire-errors.ts). A bare, governed model door: no assistant, no thread, no
 * tools of Tale's own.
 */

/** A model-endpoint body's byte cap: the Anthropic Messages API's own 32 MB
 * request limit, so a conversation with images the vendor would take is not
 * refused here first. */
const MODEL_API_BODY_BYTES = 32 * 1024 * 1024;

/** The Messages API version a caller that names none is served under. */
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/** The longest `anthropic-beta` list relayed — a comma list of short flag
 * names; anything longer is not one. */
const MAX_ANTHROPIC_BETA_CHARS = 1_024;

function anthropicHeaders(c: Context<RestEnv>): Record<string, string> {
  const version = c.req.header('anthropic-version')?.trim();
  const beta = c.req.header('anthropic-beta')?.trim();
  return {
    'anthropic-version':
      version !== undefined && version !== '' && version.length <= 64
        ? version
        : DEFAULT_ANTHROPIC_VERSION,
    ...(beta !== undefined &&
    beta !== '' &&
    beta.length <= MAX_ANTHROPIC_BETA_CHARS
      ? { 'anthropic-beta': beta }
      : {}),
  };
}

function callerOf(c: Context<RestEnv>): ModelApiRequestContext {
  const apiKeyId = restApiKeyId(c);
  if (apiKeyId === undefined) {
    throw new ModelApiRefusal(
      401,
      'UNAUTHORIZED',
      'The model endpoints take a personal API key as "Authorization: Bearer <key>".',
    );
  }
  return {
    organizationId: c.get('organizationId'),
    orgSlug: c.get('orgSlug'),
    userId: c.get('userId'),
    role: c.get('role'),
    apiKeyId,
    requestId: requestIdOf(c),
    signal: c.req.raw.signal,
    anthropicHeaders: anthropicHeaders(c),
  };
}

/** The request body, read for relaying: up to `maxBytes`, strict UTF-8,
 * numbers kept exact; a body that is not JSON is the wire's 400. */
async function readWireBody(
  c: Context<RestEnv>,
  options: { maxBytes: number },
): Promise<unknown> {
  const body = await readJsonBody(c, {
    maxBytes: options.maxBytes,
    relayOnly: true,
  });
  if (body !== INVALID_JSON) return body;
  const issue = c.get('bodyIssue');
  throw invalidBody(
    issue?.path ?? '',
    issue?.message ?? 'The body is not valid JSON',
  );
}

/** Answer a refusal in the wire's shape; anything else is the door's 500,
 * reshaped on the way out. */
async function answer(
  c: Context<RestEnv>,
  wire: ModelApiWire,
  run: () => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdOf(c);
  try {
    const response = await run();
    for (const [name, value] of Object.entries(wireHeaders(wire, requestId))) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  } catch (error) {
    if (error instanceof ModelApiRefusal) {
      return wireErrorResponse(wire, error, requestId);
    }
    throw error;
  }
}

export function createModelApiRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.get('/openai/models', (c) =>
    answer(c, 'openai', async () =>
      c.json(await listModelApiModelsForCaller(deps.sql, callerOf(c))),
    ),
  );

  app.post('/openai/chat/completions', (c) =>
    answer(c, 'openai', () =>
      relayModelApiRequest(deps.sql, 'openai', callerOf(c), () =>
        readWireBody(c, { maxBytes: MODEL_API_BODY_BYTES }),
      ),
    ),
  );

  app.post('/anthropic/v1/messages', (c) =>
    answer(c, 'anthropic', () =>
      relayModelApiRequest(deps.sql, 'anthropic', callerOf(c), () =>
        readWireBody(c, { maxBytes: MODEL_API_BODY_BYTES }),
      ),
    ),
  );

  return app;
}
