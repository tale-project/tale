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
 * an org may route here have none, the same constraint the builder session
 * works under.
 *
 * Transport, credentials and error redaction are `createBuilderModel`'s —
 * one wire for the builder, thread titles, and llm nodes.
 */

import { Ajv } from 'ajv';

import type {
  BuilderMessage,
  BuilderModel,
} from '../../lib/automations_builder/session';
import type { ActionCtx } from '../_generated/server';
import {
  createBuilderModel,
  type BuilderModelTarget,
} from '../automations_builder/model_call';
import { walkDirectServing } from '../lib/providers/agent_serving';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';

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

const ajv = new Ajv({ allErrors: true, strict: false });

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
 * `pinnedProvider` (a project agent's saved pick) narrows the scan to that
 * one connector, FAIL-CLOSED: when the pinned provider cannot serve the
 * model, the resolution throws rather than silently routing — and billing —
 * another provider. Unpinned callers (llm nodes, legacy agent rows) keep the
 * full first-match walk. Automation `agent` nodes resolve through
 * `resolveWorkflowAgentServing` instead, which adds the subscription pass
 * this direct-only door deliberately refuses.
 */
export async function resolveServingTarget(
  ctx: ActionCtx,
  organizationId: string,
  modelId: string,
  opts?: { pinnedProvider?: string },
): Promise<BuilderModelTarget> {
  const allConnectors = await resolveProvidersForOrgId(ctx, organizationId);
  const pinned = opts?.pinnedProvider;
  const connectors =
    pinned === undefined
      ? allConnectors
      : allConnectors.filter((connector) => connector.name === pinned);
  if (pinned !== undefined && connectors.length === 0) {
    throw new Error(
      `the agent pins provider "${pinned}", which is not configured for this organization — edit the agent's model or reconnect the provider`,
    );
  }
  const walk = await walkDirectServing(
    ctx,
    organizationId,
    modelId,
    connectors,
  );
  if (walk.target !== null) return walk.target;
  const detail =
    walk.unreachable.length > 0
      ? ` (the catalog for ${walk.unreachable.map((name) => `"${name}"`).join(', ')} was unreachable)`
      : '';
  if (pinned !== undefined) {
    throw new Error(
      `provider "${pinned}" cannot serve model "${modelId}" — it needs an active default api-key/env credential whose catalog lists the model and whose allowlist permits it${detail}`,
    );
  }
  throw new Error(
    `no configured provider serves model "${modelId}" — an llm node's model must be listed in a connected provider's catalog and permitted by its credential${detail}`,
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
  throw new Error('nothing in the reply parses as a JSON value');
}

/** Null when the value satisfies the schema, else a compact account of the
 * first violations. The schema is cloned before compiling: Ajv treats the
 * object as its own, and the node's document must stay untouched. */
export function schemaViolations(
  schema: Record<string, unknown>,
  value: unknown,
): string | null {
  const check = ajv.compile(structuredClone(schema));
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

/**
 * The real llm door for one run. Resolution is memoized per model for the
 * turn: a forEach loop calls the same model dozens of times, and the serving
 * connector cannot change in a way the run should chase mid-flight.
 */
export function automationLlmCall(
  ctx: ActionCtx,
  organizationId: string,
): AutomationLlmCall {
  const models = new Map<string, Promise<BuilderModel>>();
  const modelFor = (modelId: string): Promise<BuilderModel> => {
    const existing = models.get(modelId);
    if (existing) return existing;
    const created = resolveServingTarget(ctx, organizationId, modelId).then(
      (target) =>
        createBuilderModel(ctx, {
          organizationId,
          target,
          maxTokens: LLM_NODE_MAX_TOKENS,
        }),
    );
    models.set(modelId, created);
    return created;
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
    const reply = await model({
      messages,
      temperature: LLM_NODE_TEMPERATURE,
      turn: 1,
    });
    if (request.outputSchema === undefined) {
      return { text: reply.content };
    }
    let value: unknown;
    try {
      value = extractJsonValue(reply.content);
    } catch (error) {
      throw new Error(
        `the model's reply is not the JSON its outputSchema requires: ${describe(error)}`,
        { cause: error },
      );
    }
    const violations = schemaViolations(request.outputSchema, value);
    if (violations !== null) {
      throw new Error(
        `the model's reply does not satisfy the node's outputSchema: ${violations}`,
      );
    }
    return { data: value };
  };
}
