import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';

import {
  type ComposerModelOption,
  servedByDirectCredential,
} from '../../core/chat/composer.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import { listGovernedChatModels } from '../chat/composer.ts';

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
 * provisioned into the gateway).
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
  pricing?: { inputCentsPerMillion: number; outputCentsPerMillion: number };
  /** The connector declares a native Anthropic endpoint for Anthropic-wire
   * clients (`harnessEndpoint`) — the Anthropic door rides it. */
  connector: Pick<ProviderDefinition, 'name' | 'harnessEndpoint'>;
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
  });
  const connectors = new Map(
    resolveProvidersForOrg(caller.orgSlug).map(
      (connector) => [connector.name, connector] as const,
    ),
  );
  const models: ModelApiModel[] = [];
  for (const option of options) {
    if (!servedByDirectCredential(option)) continue;
    const connector = connectors.get(option.providerSlug);
    if (connector === undefined || !gatewayServable(connector)) continue;
    models.push(toModel(option, connector));
  }
  return models;
}
