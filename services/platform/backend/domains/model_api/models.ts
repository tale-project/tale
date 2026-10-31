import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import { isStandardGatewayProvider } from '../../../lib/shared/providers/gateway_standard_providers.ts';
import {
  type ComposerModelOption,
  servedByDirectCredential,
} from '../../core/chat/composer.ts';
import {
  gatewayBuiltinRefusal,
  type HiddenModelsRule,
  type ModelEndpointPolicy,
  type ModelEndpointRefusalData,
  modelEndpointRefusal,
  withoutRefusedModels,
} from '../../core/governance/model_endpoint_gate.ts';
import { ridesAnthropicHarnessEndpoint } from '../../core/lib/providers/agent_serving.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import { listGovernedChatModels } from '../chat/composer.ts';
import type { ModelApiWire } from './wire.ts';

/**
 * The models a key holder may call through the model endpoints for API keys,
 * and the one id both wires name them by.
 *
 * The listing is the composer's governed set — each provider's servable
 * catalog under its active default credential, the credential's model
 * allowlist applied, chat models only, filtered by the member's model access
 * — narrowed to what the sandbox LLM gateway can serve: a direct credential
 * (a subscription model runs only in its vendor's harness) on a connector
 * with a fixed endpoint (a per-credential endpoint, Azure's, is not
 * provisioned into the gateway). It keeps the models the EU/EEA processing
 * rule refuses, so a request that names one is answered with the rule's own
 * refusal; what a key holder is offered leaves them out
 * ({@link offeredModelApiModels}).
 *
 * The id is `<providerSlug>/<modelId>`: the connector's slug, a slash, and
 * the model's id in that connector's own catalog — the catalog id may itself
 * hold slashes (`openrouter/anthropic/claude-sonnet-4.6`), so a request's id
 * is split at its FIRST slash. The provider is part of the id because two
 * connectors can serve the same catalog id.
 */

export interface ModelApiModel {
  /** `<providerSlug>/<modelId>` — what `model` names on either wire. */
  id: string;
  providerSlug: string;
  /** The id in the connector's own catalog — what model access judges and
   * the gateway routes. */
  modelId: string;
  label: string;
  vision: boolean;
  tools: boolean;
  contextWindow: number;
  maxOutputTokens?: number;
  /** The catalog's price — with the cache rates where the catalog names
   * them, which the settlement prices a reported cache read at. */
  pricing?: ModelCatalogEntry['pricing'];
  /** The connector's endpoint, and the native Anthropic endpoint it may
   * declare for Anthropic-wire clients (`harnessEndpoint`) — the Anthropic
   * door rides it. */
  connector: Pick<ProviderDefinition, 'name' | 'baseUrl' | 'harnessEndpoint'>;
}

export function modelApiId(providerSlug: string, modelId: string): string {
  return `${providerSlug}/${modelId}`;
}

/** A model id split into its connector and catalog halves, or null when it
 * names no connector. */
export function splitModelApiId(
  id: string,
): { providerSlug: string; modelId: string } | null {
  const slash = id.indexOf('/');
  if (slash <= 0 || slash === id.length - 1) return null;
  return { providerSlug: id.slice(0, slash), modelId: id.slice(slash + 1) };
}

/** Whether `model`'s requests on `wire` ride the connector's native
 * Anthropic endpoint — a gateway record of their own, whose upstream is that
 * endpoint (`resolveGatewayRouting`'s Anthropic lane). */
export function ridesModelApiAnthropicLane(
  wire: ModelApiWire,
  model: Pick<ModelApiModel, 'connector'>,
): boolean {
  return ridesAnthropicHarnessEndpoint(
    wire === 'anthropic' ? 'anthropic' : 'openai-chat',
    model.connector,
  );
}

/**
 * The EU/EEA processing rule's verdict on `model`'s requests on `wire`
 * (GOV-R17) — undefined when it lets them through. The endpoint is the one
 * the gateway would call: a custom provider's own, and on the Anthropic lane
 * the connector's native Anthropic endpoint; a vendor the gateway implements
 * itself it reaches through its built-in connection, whatever endpoint the
 * provider names.
 */
export function modelApiEndpointRefusal(
  policy: ModelEndpointPolicy,
  wire: ModelApiWire,
  model: Pick<ModelApiModel, 'providerSlug' | 'connector'>,
): ModelEndpointRefusalData | undefined {
  const providerName = model.providerSlug;
  if (ridesModelApiAnthropicLane(wire, model)) {
    return modelEndpointRefusal(policy, {
      providerName,
      baseUrl: model.connector.harnessEndpoint?.baseUrl,
    });
  }
  return isStandardGatewayProvider(providerName)
    ? gatewayBuiltinRefusal(policy, providerName)
    : modelEndpointRefusal(policy, {
        providerName,
        baseUrl: model.connector.baseUrl,
      });
}

/** What a key holder is offered on `wires` (GOV-R22): `models` less the ones
 * the EU/EEA rule refuses on every one of them, and why when it left any
 * out. */
export function offeredModelApiModels(
  policy: ModelEndpointPolicy,
  models: readonly ModelApiModel[],
  wires: readonly ModelApiWire[],
): { readonly kept: ModelApiModel[]; readonly hiddenBy?: HiddenModelsRule } {
  return withoutRefusedModels(policy, models, (model) => {
    let refusal: ModelEndpointRefusalData | undefined;
    for (const wire of wires) {
      refusal = modelApiEndpointRefusal(policy, wire, model);
      if (refusal === undefined) return undefined;
    }
    return refusal;
  });
}

/** Whether the gateway can serve a connector at all. */
function gatewayServable(connector: ProviderDefinition): boolean {
  return connector.endpointMode !== 'per-credential';
}

function toModel(
  option: ComposerModelOption,
  connector: ProviderDefinition,
): ModelApiModel {
  return {
    id: modelApiId(option.providerSlug, option.id),
    providerSlug: option.providerSlug,
    modelId: option.id,
    label: option.label,
    vision: option.vision === true,
    tools: option.tools,
    contextWindow: option.contextWindow,
    ...(option.maxOutputTokens !== undefined
      ? { maxOutputTokens: option.maxOutputTokens }
      : {}),
    ...(option.pricing !== undefined ? { pricing: option.pricing } : {}),
    connector: {
      name: connector.name,
      ...(connector.baseUrl !== undefined
        ? { baseUrl: connector.baseUrl }
        : {}),
      ...(connector.harnessEndpoint !== undefined
        ? { harnessEndpoint: connector.harnessEndpoint }
        : {}),
    },
  };
}

export async function listModelApiModels(
  sql: Sql,
  caller: { organizationId: string; orgSlug: string; userId: string },
): Promise<ModelApiModel[]> {
  const options = await listGovernedChatModels(sql, {
    organizationId: caller.organizationId,
    userId: caller.userId,
    withRefusedEndpoints: true,
  });
  const connectors = new Map(
    resolveProvidersForOrg(caller.orgSlug).map(
      (connector) => [connector.name, connector] as const,
    ),
  );
  const models: ModelApiModel[] = [];
  for (const option of options) {
    if (!servedByDirectCredential(option)) continue;
    // These endpoints relay Chat Completions and Anthropic Messages; a model
    // whose tools work only on the Responses API would answer an editor's
    // tool call with a 400.
    if (option.toolCallingApi === 'responses') continue;
    const connector = connectors.get(option.providerSlug);
    if (connector === undefined || !gatewayServable(connector)) continue;
    models.push(toModel(option, connector));
  }
  return models;
}
