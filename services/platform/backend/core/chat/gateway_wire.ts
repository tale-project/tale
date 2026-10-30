'use node';

/**
 * Which API a direct chat round asks a gateway on — an OpenAI-format provider
 * that routes other vendors' models: one the organization defined itself (a
 * custom provider such as Bifrost or LiteLLM), or one that lists its models
 * from its own models endpoint (the Vercel AI Gateway) — and what the
 * platform learns from the gateway's answers.
 *
 * A gateway takes Chat Completions for every model it routes and translates
 * them itself. For an OpenAI model whose tools the vendor serves only on the
 * Responses API — outright (`toolCallingApi: responses`) or together with any
 * reasoning effort (`reasoning.toolsRequireOff`) — that means calling the
 * vendor's Responses API and converting its stream back into Chat Completions
 * deltas. The conversion can lose a tool call's arguments: the Responses API
 * may deliver them only in the events that close the call
 * (`response.function_call_arguments.done`, `response.output_item.done`), and
 * a converter that reads only the deltas (Bifrost's) hands the call on with
 * no arguments at all. Asked on its own Responses API, a gateway relays those
 * events as they are, and the platform's reader takes the complete arguments
 * from them. So a direct round asks a gateway's Responses API for such a
 * model, with the body a model that declares that API itself gets.
 *
 * Answers change that for one organization's gateway and model, for a while:
 *  - a gateway that refuses the Responses request before streaming (no such
 *    route, a route its key may not use, a body it does not take) is asked on
 *    Chat Completions in the same round, as before; when Chat Completions
 *    takes it, later rounds go there directly;
 *  - a Chat Completions round that ends on a call to a tool which requires
 *    input, with no argument bytes at all — not even the `{}` a model sends
 *    when it leaves its input out — marks the model as losing arguments on
 *    that wire: later rounds ask the Responses API, which covers a model the
 *    shipped catalogs do not know yet. A Responses round only that mark
 *    picked, which the gateway accepts and then fails, counts as a refusal.
 * A refusal outranks a loss: Chat Completions is then the only wire left.
 * Both are remembered per backend process and for a bounded time, so a
 * gateway that changes is asked again.
 */

import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { LRUCache } from 'lru-cache';

import type { TurnSampling } from '../../../lib/chat/effort';
import type { WireTool } from '../../../lib/chat/tools';
import { knownModel } from '../lib/providers/catalog_fetch';
import { loadProviderDefinitions } from '../lib/providers/load_system_config';

/** The statuses a gateway answers a Responses request with when it cannot
 * serve that API for the model: no such route (404, 405, 501), a route the
 * key may not use or a front door that guards only the paths it knows (401,
 * 403), or a body it does not take (400, 415, 422). Limits and outages (429,
 * 5xx) would fail on Chat Completions just the same, and surface as they
 * are. */
export const RESPONSES_REFUSAL_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 405, 415, 422, 501,
]);

/** How long a refusal holds before the gateway is asked again. */
const REFUSAL_TTL_MS = 15 * 60 * 1000;
/** How long a model that lost arguments on Chat Completions stays on the
 * Responses API. */
const LOSS_TTL_MS = 24 * 60 * 60 * 1000;
/** Gateway models remembered, per memory. */
const REMEMBERED_MODELS = 512;

const refused = new LRUCache<string, true>({
  max: REMEMBERED_MODELS,
  ttl: REFUSAL_TTL_MS,
});
const lossy = new LRUCache<string, true>({
  max: REMEMBERED_MODELS,
  ttl: LOSS_TTL_MS,
});

/** One organization's model on one gateway: what the memories key on. Two
 * organizations on the same gateway hold different keys, which may reach
 * different routes. */
export interface GatewayModel {
  readonly organizationId: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly modelId: string;
}

function keyOf(model: GatewayModel): string {
  return JSON.stringify([
    model.organizationId,
    model.provider,
    model.baseUrl,
    model.modelId,
  ]);
}

/** A gateway in this sense: an OpenAI-format provider that lists its models
 * from its own models endpoint, or one the organization defined itself —
 * with its model IDs entered by hand, it lists none. The shipped providers
 * without a listing (Azure, Nous Portal) serve their own models. */
export function isOpenAiGateway(
  connector: Pick<ProviderDefinition, 'apiFormat' | 'catalog' | 'name'>,
): boolean {
  if (connector.apiFormat !== 'openai') return false;
  if (connector.catalog.source === 'models-endpoint') return true;
  return (
    connector.catalog.source === 'none' &&
    !loadProviderDefinitions().some(
      (shipped) => shipped.name === connector.name,
    )
  );
}

/** Why a direct round asks a gateway's Responses API: the vendor serves the
 * model's tools only there, or a Chat Completions round lost a call's
 * arguments. */
export type GatewayResponsesPick = 'vendor' | 'lost-arguments';

/** Whether — and why — a direct round asks the gateway's Responses API for
 * the model (see the module doc). */
export function gatewayResponsesPick(
  connector: Pick<ProviderDefinition, 'apiFormat' | 'catalog' | 'name'>,
  model: GatewayModel,
): GatewayResponsesPick | undefined {
  if (!isOpenAiGateway(connector)) return undefined;
  const key = keyOf(model);
  if (refused.has(key)) return undefined;
  const known = knownModel(model.modelId);
  if (
    known !== undefined &&
    (known.toolCallingApi === 'responses' ||
      known.reasoning?.toolsRequireOff === true)
  ) {
    return 'vendor';
  }
  return lossy.has(key) ? 'lost-arguments' : undefined;
}

/** The gateway refused the Responses API for the model: ask it on Chat
 * Completions for a while. */
export function noteResponsesRefused(model: GatewayModel): void {
  refused.set(keyOf(model), true);
}

/** A Chat Completions round lost a call's arguments: ask the Responses API
 * for a while. False when the gateway refused that API for the model, which
 * leaves Chat Completions the only wire to ask. */
export function noteArgumentsLost(model: GatewayModel): boolean {
  const key = keyOf(model);
  lossy.set(key, true);
  return !refused.has(key);
}

/** The reasoning a gateway's Responses API is asked for. A gateway names no
 * model's top effort level, and only the newest OpenAI models take `max`
 * (GPT-5.5 and the 5.6 trio stop at `xhigh`), so the top step is asked as
 * `xhigh`, which every model this rule picks takes; Chat Completions spelled
 * both top steps `high`. */
export function gatewayResponsesReasoning(
  reasoning: TurnSampling['reasoning'],
): TurnSampling['reasoning'] {
  return reasoning?.kind === 'effort' && reasoning.value === 'max'
    ? { kind: 'effort', value: 'extra' }
    : reasoning;
}

/** The first of `calledTools` — the tools a round called with no argument
 * bytes at all — whose schema requires input: evidence the arguments were
 * lost on the way rather than left out. A tool that takes no input may be
 * called with nothing. */
export function toolMissingInput(
  calledTools: readonly string[],
  tools: readonly WireTool[] | undefined,
): string | undefined {
  return calledTools.find((name) => {
    const required = tools?.find((tool) => tool.name === name)?.parameters
      .required;
    return Array.isArray(required) && required.length > 0;
  });
}

/** Forget every refusal and loss — for tests, which share the process. */
export function forgetGatewayWires(): void {
  refused.clear();
  lossy.clear();
}
