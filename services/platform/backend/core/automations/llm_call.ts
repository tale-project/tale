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

import type { HarnessGatewayWire } from '@tale/shared/schemas/providers';

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
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { NodeFailure } from './failure';

/** What one llm node asks for — the engine seam's shape, minus nothing. */
export interface AutomationLlmRequest {
  model: string;
  prompt: string;
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

/** The run's admission of one call, read off the untyped ctx seam: the
 * lease is the shim's own and goes back to it as it came. */
type LlmStepAdmission =
  | { allowed: true; lease: unknown }
  | { allowed: false; reason: string };

function readLlmStepAdmission(value: unknown): LlmStepAdmission {
  if (typeof value === 'object' && value !== null) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed field by field below
    const record = value as {
      allowed?: unknown;
      reason?: unknown;
      lease?: unknown;
    };
    if (
      record.allowed === true &&
      typeof record.lease === 'object' &&
      record.lease !== null
    ) {
      return { allowed: true, lease: record.lease };
    }
    if (record.allowed === false && typeof record.reason === 'string') {
      return { allowed: false, reason: record.reason };
    }
  }
  throw new Error(
    'openLlmStepCall answered with an unexpected shape — the llm call cannot be admitted',
  );
}

/** A model the door resolved, and the connector and catalog id that serve
 * it — the pair its spend is priced and booked under. */
interface ServedModel {
  target: BuilderModelTarget;
  call: BuilderModel;
}

/** The run each call is made for. */
export interface AutomationLlmRun {
  runId: string;
  /** The run's automation: the ledger's label for its calls. */
  automation: string;
}

/**
 * The real llm door for one run. Resolution is memoized per model for the
 * turn: a forEach loop calls the same model dozens of times, and the serving
 * connector cannot change in a way the run should chase mid-flight.
 *
 * Every call is the run's spend: before it, its worst case — the prompt
 * and the node's whole output cap — is held against the caps that bind the
 * run (its starter's, the automation subject's for a run a trigger
 * started, its key's, its projects' and the organization's), and the call
 * is refused with `budget_exceeded` once a cap has too little room; after
 * it, reply or not, the tokens the provider reported are booked in the
 * hold's place.
 */
export function automationLlmCall(
  ctx: ActionCtx,
  organizationId: string,
  run: AutomationLlmRun,
): AutomationLlmCall {
  const models = new Map<string, Promise<ServedModel>>();
  const modelFor = (modelId: string): Promise<ServedModel> => {
    const existing = models.get(modelId);
    if (existing) return existing;
    const created = resolveServingTarget(ctx, organizationId, modelId).then(
      (target) => ({
        target,
        call: createBuilderModel(ctx, {
          organizationId,
          target,
          maxTokens: LLM_NODE_MAX_TOKENS,
        }),
      }),
    );
    models.set(modelId, created);
    return created;
  };
  const settle = async (
    lease: unknown,
    target: BuilderModelTarget,
    usage: { prompt: number; completion: number },
  ): Promise<void> => {
    try {
      await ctx.runMutation(internal.automations.mutations.settleLlmStepCall, {
        organizationId,
        lease,
        provider: target.providerSlug,
        model: target.modelId,
        inputTokens: usage.prompt,
        outputTokens: usage.completion,
      });
    } catch (error) {
      // The step has its reply, and the spend happened either way: a
      // ledger write that failed must not fail the run. Its hold lapses at
      // its deadline.
      console.warn(
        `[automations] run ${run.runId}: booking an llm call to ${target.providerSlug}/${target.modelId} failed:`,
        error,
      );
    }
  };
  const release = async (lease: unknown): Promise<void> => {
    try {
      await ctx.runMutation(internal.automations.mutations.releaseLlmStepCall, {
        lease,
      });
    } catch (error) {
      console.warn(
        `[automations] run ${run.runId}: releasing an llm call's hold failed; it lapses at its deadline:`,
        error,
      );
    }
  };

  return async (request) => {
    const model = await modelFor(request.model);
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
    const admission = readLlmStepAdmission(
      await ctx.runMutation(internal.automations.mutations.openLlmStepCall, {
        organizationId,
        runId: run.runId,
        automation: run.automation,
        provider: model.target.providerSlug,
        model: model.target.modelId,
        promptTokens: estimateTokens(
          messages.map((message) => message.content).join('\n'),
        ),
        maxOutputTokens: LLM_NODE_MAX_TOKENS,
      }),
    );
    if (!admission.allowed) {
      throw new NodeFailure(
        'budget_exceeded',
        `the llm call was refused: ${admission.reason}`,
        'wait until the limit resets, or ask an administrator to raise it',
      );
    }
    let reply: Awaited<ReturnType<BuilderModel>>;
    try {
      reply = await model.call({
        messages,
        temperature: LLM_NODE_TEMPERATURE,
        turn: 1,
      });
    } catch (error) {
      // A reply with no text — a model that spent its budget reasoning —
      // was still billed; any other failure reported no usage to book.
      if (error instanceof EmptyReplyError) {
        await settle(admission.lease, model.target, error.usage);
      } else {
        await release(admission.lease);
      }
      throw error;
    }
    if (reply.usage !== undefined) {
      await settle(admission.lease, model.target, reply.usage);
    } else {
      await release(admission.lease);
    }
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
