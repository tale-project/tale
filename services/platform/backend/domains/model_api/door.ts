import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { getUserTeamIds } from '../../auth/membership.ts';
import { evaluateModelAccess } from '../../core/governance/model_access_enforcement.ts';
import {
  type ModelApiCaller,
  type ModelApiGate,
  resolveModelApiGate,
} from './access.ts';
import {
  anthropicUpstreamBody,
  inspectAnthropicMessagesRequest,
} from './anthropic.ts';
import { buildModelApiGuardrails } from './guardrails.ts';
import {
  closeModelApiLease,
  heartbeatModelApiOp,
  modelApiHoldCents,
  openModelApiLease,
} from './metering.ts';
import {
  listModelApiModels,
  type ModelApiModel,
  splitModelApiId,
} from './models.ts';
import {
  inspectOpenAiChatRequest,
  openAiStreamIncludesUsage,
  openAiUpstreamBody,
} from './openai.ts';
import { type RelayOutcome, relayToGateway } from './relay.ts';
import {
  estimatePromptTokens,
  ModelApiRefusal,
  type ModelApiWire,
  type WireRequest,
} from './wire.ts';

/**
 * The model endpoints for API keys — one governed request, end to end:
 *
 *  1. the door is open: the organization turned it on and the key holder may
 *     call it (`access.ts`);
 *  2. the body is a request the door can govern (`openai.ts`,
 *     `anthropic.ts`);
 *  3. the model is one the holder may call: listed for them — the
 *     credential's allowlist and their model access applied — and allowed by
 *     the model-access rules read fresh;
 *  4. the model can read what is sent: images need a vision model, tools a
 *     model that takes them;
 *  5. the organization's input guardrails pass (and mask) the system and
 *     user text (`guardrails.ts`);
 *  6. the hold is reserved and the request's gateway key minted
 *     (`metering.ts`);
 *  7. the request is relayed and the answer returned in the caller's wire
 *     (`relay.ts`); its spend is booked once it ends.
 *
 * Every refusal is a {@link ModelApiRefusal} the route answers in the
 * wire's error shape.
 */

/** The authenticated caller, as the REST door resolved them. */
export interface ModelApiRequestContext extends ModelApiCaller {
  orgSlug: string;
  /** The API key the bearer verified as — every request is keyed. */
  apiKeyId: string;
  /** The request id the caller can quote (`X-Request-Id`). */
  requestId: string | undefined;
  /** The caller's connection. */
  signal: AbortSignal;
  /** `anthropic-version` / `anthropic-beta` as the caller sent them. */
  anthropicHeaders: Record<string, string>;
}

const DISABLED_MESSAGE =
  'The model endpoints are not enabled for this organization. An admin turns them on under Settings → Governance → Models → Model access.';
const FORBIDDEN_MESSAGE =
  'Your role cannot call the model endpoints. Owners, admins and developers can; any other member needs the "Call models over the API" capability (tale:models.api), granted under Settings → Governance → Competences.';
const UNAVAILABLE_MESSAGE =
  "The organization's model access policy cannot be read right now, so the model endpoints stay closed; try again shortly.";

/** Open the door, or throw the refusal that says why it stays shut. */
async function openDoor(
  sql: Sql,
  caller: ModelApiCaller,
): Promise<Extract<ModelApiGate, { kind: 'open' }>> {
  const gate = await resolveModelApiGate(sql, caller);
  if (gate.kind === 'open') return gate;
  if (gate.kind === 'disabled') {
    throw new ModelApiRefusal(403, 'MODEL_API_DISABLED', DISABLED_MESSAGE);
  }
  if (gate.kind === 'forbidden') {
    throw new ModelApiRefusal(403, 'MODEL_API_FORBIDDEN', FORBIDDEN_MESSAGE);
  }
  throw new ModelApiRefusal(503, 'MODEL_API_UNAVAILABLE', UNAVAILABLE_MESSAGE, {
    headers: { 'retry-after': '30' },
  });
}

/** `GET /api/v1/openai/models` — the OpenAI list of what the holder may
 * call. `created` is 0: the catalog records no release date. */
export async function listModelApiModelsForCaller(
  sql: Sql,
  caller: ModelApiRequestContext,
): Promise<Record<string, unknown>> {
  await openDoor(sql, caller);
  const models = await listModelApiModels(sql, caller);
  return {
    object: 'list',
    data: models.map((model) => ({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: model.providerSlug,
    })),
  };
}

/** The listed model the request names, or the refusal that says why not. */
async function resolveModel(
  sql: Sql,
  caller: ModelApiRequestContext,
  policy: Parameters<typeof evaluateModelAccess>[0],
  requested: string,
): Promise<ModelApiModel> {
  const who = {
    userId: caller.userId,
    teamIds: await getUserTeamIds(sql, caller.organizationId, caller.userId),
    userRole: caller.role,
  };
  const split = splitModelApiId(requested);
  if (split !== null) {
    const verdict = evaluateModelAccess(policy, who, split.modelId);
    if (!verdict.allowed) {
      throw new ModelApiRefusal(
        403,
        'MODEL_API_MODEL_FORBIDDEN',
        verdict.reason ??
          `Model "${requested}" is not available for your account.`,
        { param: 'model' },
      );
    }
  }
  const model = (await listModelApiModels(sql, caller)).find(
    (candidate) => candidate.id === requested,
  );
  if (model === undefined) {
    throw new ModelApiRefusal(
      404,
      'MODEL_API_MODEL_UNKNOWN',
      `Unknown model "${requested}". A model id is <provider>/<model> — GET /api/v1/openai/models lists the ones this key can call.`,
      { param: 'model' },
    );
  }
  return model;
}

function checkCapabilities(model: ModelApiModel, request: WireRequest): void {
  if (request.imageCount > 0 && !model.vision) {
    throw new ModelApiRefusal(
      400,
      'MODEL_API_VISION_UNSUPPORTED',
      `Model "${model.id}" does not read images; send text only, or pick a model with vision.`,
      { param: 'messages' },
    );
  }
  if (request.offersTools && !model.tools) {
    throw new ModelApiRefusal(
      400,
      'MODEL_API_TOOLS_UNSUPPORTED',
      `Model "${model.id}" does not take tools; send the request without tools, or pick a model that calls them.`,
      { param: 'tools' },
    );
  }
}

/** Govern one request on `wire` and relay it; the answer (or the wire's
 * refusal body from upstream) is the response. The body is read only once
 * the door is open — a shut door never buffers a large body to refuse it. */
export async function relayModelApiRequest(
  sql: Sql,
  wire: ModelApiWire,
  caller: ModelApiRequestContext,
  readBody: () => Promise<unknown>,
): Promise<Response> {
  const gate = await openDoor(sql, caller);
  const rawBody = await readBody();
  const request =
    wire === 'openai'
      ? inspectOpenAiChatRequest(rawBody)
      : inspectAnthropicMessagesRequest(rawBody);
  const model = await resolveModel(sql, caller, gate.policy, request.model);
  checkCapabilities(model, request);

  // The op row's own id; the guardrail events carry the request id the
  // caller can quote, so an admin can find the request they ask about.
  const requestId = randomUUID();
  const guardrails = await buildModelApiGuardrails(sql, {
    organizationId: caller.organizationId,
    requestId: caller.requestId ?? requestId,
  });
  await guardrails.apply(request.segments);

  const lease = await openModelApiLease(sql, {
    organizationId: caller.organizationId,
    userId: caller.userId,
    apiKeyId: caller.apiKeyId,
    requestId,
    wire,
    model,
    holdCents: modelApiHoldCents(
      model,
      estimatePromptTokens(request),
      request.maxOutputTokens,
      request.choiceCount,
    ),
  });
  const stopHeartbeat = heartbeatModelApiOp(sql, lease);
  let closed = false;
  const close = (outcome: RelayOutcome) => {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    closeModelApiLease(sql, lease, outcome.status, outcome.usage);
  };
  try {
    return await relayToGateway({
      wire,
      publicModel: model.id,
      gatewayModel: lease.gatewayModel,
      token: lease.token,
      body:
        wire === 'openai'
          ? openAiUpstreamBody(request, lease.gatewayModel)
          : anthropicUpstreamBody(request, lease.gatewayModel),
      stream: request.stream,
      dropUsageChunk:
        wire === 'openai' &&
        request.stream &&
        !openAiStreamIncludesUsage(request.body),
      anthropicHeaders: caller.anthropicHeaders,
      requestId: caller.requestId,
      signal: caller.signal,
      onDone: close,
    });
  } catch (error) {
    // Whatever stopped the relay, the lease closes: its key is settled and
    // deleted, its hold released.
    close({ status: 'failed' });
    throw error;
  }
}
