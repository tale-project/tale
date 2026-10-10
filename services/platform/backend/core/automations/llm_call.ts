'use node';

/**
 * The live lane for `llm` nodes: one prompt in, one reply out.
 *
 * An llm node is a plain model call — no tools, no turns, no substitution.
 * The node names its model explicitly and this module finds the one org
 * connector that serves it: the first connector (shipped order, then
 * org-defined) whose default credential admits a direct call, whose allowlist
 * permits the model, and whose catalog lists it. No connector serving it is a
 * clean node failure, never a silent switch to a different model.
 *
 * With `outputSchema` the reply must be the schema's JSON: the request says so
 * in the system prompt, the reply is parsed (bare or fenced) and validated
 * with the same Ajv configuration the engine's validators use, and the node
 * gets `{data}`. Tool calling is deliberately not used — the smallest models
 * an org may route here have none.
 *
 * Transport, credentials and error redaction are `createBuilderModel`'s —
 * one wire for thread titles and llm nodes.
 */

import type {
  HarnessGatewayWire,
  ModelCatalogEntry,
} from '@tale/shared/schemas/providers';

import { estimateCostCents } from '../../../lib/chat/turn';
import { estimateTokens } from '../../../lib/chat/types';
import { compileSchema } from '../../../lib/engine/core/validate/schema';
import { EmptyReplyError } from '../automations_builder/chat_wire';
import {
  createBuilderModel,
  type BuilderMessage,
  type BuilderModel,
  type BuilderModelTarget,
} from '../automations_builder/model_call';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import {
  responsesToolsRefusal,
  walkDirectServing,
  type DirectServingWalk,
} from '../lib/providers/agent_serving';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { NodeFailure } from './failure';
import {
  AUTOMATION_LLM_LIFETIME_MS,
  type LlmAttemptAddress,
} from './llm_budget';

/** What one llm node asks for — the engine seam's shape, minus nothing. */
export interface AutomationLlmRequest {
  model: string;
  prompt: string;
  attempt?: LlmAttemptAddress;
  system?: string;
  outputSchema?: Record<string, unknown>;
}

export type AutomationLlmReply = { text: string } | { data: unknown };

/** The per-run llm door: built once per turn, bound to that turn's ctx and
 * organization, carried on the run context like every other capability. */
export type AutomationLlmCall = (
  request: AutomationLlmRequest,
) => Promise<AutomationLlmReply>;

/** Automation output should be steady run to run; the knob is deliberately
 * not exposed on the node. */
const LLM_NODE_TEMPERATURE = 0.2;
/** Ceiling for one reply. Nodes summarize and score; a document-sized budget
 * (the builder's own) covers every shipped pack with room. */
const LLM_NODE_MAX_TOKENS = 8000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which org connector serves this model DIRECTLY. The scan is
 * {@link walkDirectServing} (one implementation shared with the agent-turn
 * resolvers, so the walks can never drift): only connectors whose default
 * credential is active and direct-capable count, the credential's allowlist
 * is honored, and an unreachable catalog skips the connector rather than
 * failing the node — unless nothing else serves the model, in which case the
 * failure names it. The returned `modelId` is the catalog entry's id — the
 * spelling the serving connector accepts on the wire — not the pack's.
 *
 * This door is deliberately unpinned and direct-only: agent turns that carry
 * a provider pin resolve through `resolvePinnedAgentServing`, and automation
 * `agent` nodes through `resolveWorkflowAgentServing`, which adds the
 * subscription pass a raw API call must refuse.
 */
export async function resolveServingTarget(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  /** Legacy task agents share this direct-only walk but carry tools. */
  toolCallingWire?: HarnessGatewayWire,
): Promise<BuilderModelTarget> {
  const walk = await walkLlmServing(
    ctx,
    organizationId,
    modelId,
    toolCallingWire,
  );
  if (walk.target !== null) return walk.target;
  const detail =
    walk.unreachable.length > 0
      ? ` (the catalog for ${walk.unreachable.map((name) => `"${name}"`).join(', ')} was unreachable)`
      : '';
  // Only an agent turn passes a wire; its model was listed, but its tools
  // need the Responses API.
  if (walk.wireRefused.length > 0) {
    throw new Error(`${responsesToolsRefusal(modelId)}${detail}`);
  }
  throw new Error(
    `no configured provider serves model "${modelId}" — an llm node's model must be listed in a connected provider's catalog and permitted by its credential${detail}`,
  );
}

/**
 * The llm node's serving walk, without the verdict: which direct connector
 * serves the model, or none — and which catalogs could not be read. Shared
 * with the validator's model check (`StoreAdapter.modelAvailable`), so what
 * validation warns about is exactly what a live run would refuse.
 */
export async function walkLlmServing(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  toolCallingWire?: HarnessGatewayWire,
): Promise<DirectServingWalk> {
  const connectors = await resolveProvidersForOrgId(ctx, organizationId);
  return walkDirectServing(
    ctx,
    organizationId,
    modelId,
    connectors,
    toolCallingWire,
  );
}

const MISS = Symbol('not json');

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return MISS;
  }
}

/**
 * The model's JSON, wherever it put it: the bare reply, a ``` fence, or the
 * outermost object or array with prose around it. Throws when nothing parses.
 */
export function extractJsonValue(reply: string): unknown {
  const direct = tryParse(reply.trim());
  if (direct !== MISS) return direct;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  if (fence?.[1] !== undefined) {
    const fenced = tryParse(fence[1].trim());
    if (fenced !== MISS) return fenced;
  }
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = reply.indexOf(open);
    const end = reply.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const sliced = tryParse(reply.slice(start, end + 1));
      if (sliced !== MISS) return sliced;
    }
  }
  throw new NodeFailure(
    'llm_output_invalid',
    'nothing in the reply parses as a JSON value',
  );
}

/** Null when the value satisfies the schema, else a compact account of the
 * first violations. Compiled through the engine's ONE Ajv helper, which
 * clones the schema (the node's document stays untouched) and clears the
 * instance cache after every compile — a private instance here once kept
 * every compiled validator for the life of the worker and, for a schema
 * carrying `$id`, threw "schema with key or id already exists" on the second
 * reply it checked (every later forEach item, repeat pass and run on that
 * worker failed the node). */
export function schemaViolations(
  schema: Record<string, unknown>,
  value: unknown,
): string | null {
  const check = compileSchema(schema);
  if (check(value)) return null;
  const details = (check.errors ?? [])
    .slice(0, 3)
    .map(
      (error) =>
        `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    )
    .join('; ');
  return details === '' ? 'the value does not match the schema' : details;
}

function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    'Answer with a single JSON value that satisfies this JSON Schema, and nothing else — no prose around it:',
    JSON.stringify(schema),
  ].join('\n');
}

/** The budget check's answer, read off the untyped ctx seam. */
type LlmStepAdmission =
  | { allowed: true; sessionId: string; execId: string }
  | { allowed: false; reason: string };

function readLlmStepAdmission(value: unknown): LlmStepAdmission {
  if (typeof value === 'object' && value !== null) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed field by field below
    const record = value as {
      allowed?: unknown;
      reason?: unknown;
      sessionId?: unknown;
      execId?: unknown;
    };
    if (
      record.allowed === true &&
      typeof record.sessionId === 'string' &&
      typeof record.execId === 'string'
    )
      return {
        allowed: true,
        sessionId: record.sessionId,
        execId: record.execId,
      };
    if (record.allowed === false && typeof record.reason === 'string') {
      return { allowed: false, reason: record.reason };
    }
  }
  throw new Error(
    'reserveLlmStepBudget answered with an unexpected shape — the llm call cannot be admitted',
  );
}

/** A model the door resolved, and the connector and catalog id that serve
 * it — the pair its spend is priced and booked under. */
interface ServedModel {
  target: BuilderModelTarget;
  call: BuilderModel;
  pricing: NonNullable<ModelCatalogEntry['pricing']>;
}

/**
 * The real llm door for one run. Resolution is memoized per model for the
 * turn: a forEach loop calls the same model dozens of times, and the serving
 * connector cannot change in a way the run should chase mid-flight.
 *
 * Every call is the run's spend: measured right before it against the caps
 * that bind the run — its starter's, the automation subject's for a run a
 * trigger started, its key's, its projects' and the organization's — and
 * refused with `budget_exceeded` once one is reached; booked after it,
 * reply or not, with the tokens the provider reported.
 *
 * `signal` is the turn's: when it aborts (the server is stopping and the
 * step's grace ran out) the provider request is torn down at once rather
 * than holding the walker until the reply.
 */
export function automationLlmCall(
  ctx: ActionCtx,
  organizationId: string,
  runId: string,
  options: { signal?: AbortSignal } = {},
): AutomationLlmCall {
  const models = new Map<string, Promise<ServedModel>>();
  const modelFor = (modelId: string): Promise<ServedModel> => {
    const existing = models.get(modelId);
    if (existing) return existing;
    const created = resolveServingTarget(ctx, organizationId, modelId).then(
      async (target) => {
        const connector = (
          await resolveProvidersForOrgId(ctx, organizationId)
        ).find((entry) => entry.name === target.providerSlug);
        const pricing =
          connector === undefined
            ? undefined
            : (await getProviderCatalog(connector)).find(
                (entry) => entry.id === target.modelId,
              )?.pricing;
        if (pricing === undefined)
          throw new Error(
            'The LLM model needs catalog pricing before its budget can be reserved',
          );
        return {
          target,
          pricing,
          call: createBuilderModel(ctx, {
            organizationId,
            target,
            maxTokens: LLM_NODE_MAX_TOKENS,
            ...(options.signal !== undefined && { signal: options.signal }),
          }),
        };
      },
    );
    models.set(modelId, created);
    return created;
  };
  return async (request) => {
    if (request.attempt === undefined)
      throw new Error('An LLM call requires its durable effect attempt');
    options.signal?.throwIfAborted();
    const model = await modelFor(request.model);
    // Missing credentials/endpoints are a proven pre-dispatch failure:
    // resolve them before holding anything that could later be estimated.
    await model.call.prepare?.();
    options.signal?.throwIfAborted();
    const system = [
      ...(request.system !== undefined && request.system !== ''
        ? [request.system]
        : []),
      ...(request.outputSchema !== undefined
        ? [schemaInstruction(request.outputSchema)]
        : []),
    ].join('\n\n');
    const messages: BuilderMessage[] = [
      ...(system === '' ? [] : [{ role: 'system', content: system } as const]),
      { role: 'user', content: request.prompt } as const,
    ];
    // Include schema/system instructions and framing in the same prompt estimate.
    const inputReserve = messages.reduce(
      (total, message) => total + estimateTokens(message.content) + 4,
      3,
    );
    // Start the request clock before admission, so recovery's server-side
    // started_at deadline never precedes this call's cancellation deadline.
    const deadline = AbortSignal.timeout(AUTOMATION_LLM_LIFETIME_MS);
    const admission = readLlmStepAdmission(
      await ctx.runMutation(
        internal.automations.mutations.reserveLlmStepBudget,
        {
          organizationId,
          runId,
          attempt: request.attempt,
          provider: model.target.providerSlug,
          model: model.target.modelId,
          reserveCents: estimateCostCents(
            inputReserve,
            LLM_NODE_MAX_TOKENS,
            model.pricing,
          ),
          reserveTokens: inputReserve + LLM_NODE_MAX_TOKENS,
        },
      ),
    );
    if (!admission.allowed)
      throw new NodeFailure(
        'budget_exceeded',
        `the llm call was refused: ${admission.reason}`,
        'wait until the limit resets, or ask an administrator to raise it',
        { reason: 'BUDGET_EXCEEDED', params: { detail: admission.reason } },
      );
    const book = async (
      usage: Awaited<ReturnType<BuilderModel>>['usage'],
    ): Promise<void> => {
      const reported =
        usage?.reported === true &&
        Number.isSafeInteger(usage.prompt) &&
        usage.prompt >= 0 &&
        Number.isSafeInteger(usage.completion) &&
        usage.completion >= 0;
      await ctx.runMutation(internal.automations.mutations.recordLlmStepUsage, {
        organizationId,
        sessionId: admission.sessionId,
        execId: admission.execId,
        usage: reported
          ? {
              inputTokens: usage.prompt,
              outputTokens: usage.completion,
              cents: estimateCostCents(
                usage.prompt,
                usage.completion,
                model.pricing,
              ),
            }
          : null,
      });
    };
    if (options.signal?.aborted || deadline.aborted) {
      // Local proof of no dispatch: close this hold at known zero rather
      // than treating a cancellation before the call as unknown spend.
      await book({ prompt: 0, completion: 0, reported: true });
      options.signal?.throwIfAborted();
      deadline.throwIfAborted();
    }
    let reply: Awaited<ReturnType<BuilderModel>>;
    try {
      reply = await model.call({
        messages,
        temperature: LLM_NODE_TEMPERATURE,
        turn: 1,
        signal: deadline,
      });
    } catch (error) {
      await book(error instanceof EmptyReplyError ? error.usage : undefined);
      throw error;
    }
    // Persist before parsing/schema validation: unusable output was still paid.
    await book(reply.usage);
    if (request.outputSchema === undefined) {
      return { text: reply.content };
    }
    let value: unknown;
    try {
      value = extractJsonValue(reply.content);
    } catch (error) {
      throw new NodeFailure(
        'llm_output_invalid',
        `the model's reply is not the JSON its outputSchema requires: ${describe(error)}`,
      );
    }
    const violations = schemaViolations(request.outputSchema, value);
    if (violations !== null) {
      throw new NodeFailure(
        'llm_output_invalid',
        `the model's reply does not satisfy the node's outputSchema: ${violations}`,
      );
    }
    return { data: value };
  };
}
