import { useMemo } from 'react';

import type { ModelInfoCapabilities } from '@/app/features/chat/components/model-info-popover';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type {
  EnvSecretStatus,
  ProviderJson,
} from '@/lib/shared/schemas/providers';

import {
  mergeModelCapabilities,
  modelCapabilitiesFromConfig,
} from '../utils/model-capabilities';

/**
 * Shape returned by the `readProvider` action. The action declares `v.any()`,
 * so consumers cast to this to read `envSecretStatus` (issue #1711) and the
 * masked keys with types.
 */
export type ReadProviderResult =
  | {
      ok: true;
      config: ProviderJson;
      hash: string;
      maskedModelKeys?: Record<string, string>;
      envSecretStatus?: {
        provider: EnvSecretStatus;
        models: Record<string, EnvSecretStatus>;
      };
    }
  | { ok: false; error: string; message: string };

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

interface QueryOptions {
  /** When false the query is paused. */
  enabled?: boolean;
}

export function useListProviders(
  organizationId: string,
  options?: QueryOptions,
) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('providers', organizationId),
    api.providers.file_actions.listProviders,
    { organizationId },
    options,
  );
  return { providers: data ?? [], isLoading, error, refetch };
}

export function useReadProvider(
  organizationId: string,
  providerName: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    configKeys.detail('providers', organizationId, providerName),
    api.providers.file_actions.readProvider,
    { organizationId, providerName },
    options,
  );
}

export function useHasProviderSecret(
  organizationId: string,
  providerName: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    ['config', 'providers', organizationId, providerName, 'secret'],
    api.providers.file_actions.hasProviderSecret,
    { organizationId, providerName },
    options,
  );
}

export function useHasModelSecret(
  organizationId: string,
  providerName: string,
  modelId: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    [
      'config',
      'providers',
      organizationId,
      providerName,
      'model-secret',
      modelId,
    ],
    api.providers.file_actions.hasProviderSecret,
    { organizationId, providerName, modelId },
    options,
  );
}

/**
 * Capabilities (cost, context window, reasoning, prompt-caching, tools/vision)
 * for a set of model ids, keyed by id. Backs the `ModelInfoPopover` info button
 * across every model selector. Two sources are merged per field: the synced
 * catalog cache (`modelCapabilityCache`, populated by the daily cron and the
 * live "Fetch models" action) and the operator-declared org-config fields on
 * each provider's model. Operator declarations win per field and are available
 * before the first sync, so the popover stays useful pre-sync (issue #2357).
 * Pass the currently-visible ids only — the catalog query reads one row per id.
 */
export function useModelCapabilities(
  organizationId: string,
  modelIds: string[],
): Map<string, ModelInfoCapabilities> {
  const { data } = useConvexQuery(
    api.model_catalog.queries.getModelCapabilities,
    { organizationId, modelIds },
  );
  // Org-config capabilities are read from the provider list (the same source
  // the pickers already subscribe to); skip the fetch when no ids are wanted,
  // mirroring the gated catalog query above.
  const { providers } = useListProviders(organizationId, {
    enabled: modelIds.length > 0,
  });
  return useMemo(() => {
    const catalog = new Map<string, ModelInfoCapabilities>();
    for (const c of data ?? []) {
      catalog.set(c.modelId, {
        contextWindow: c.contextWindow,
        maxOutputTokens: c.maxOutputTokens,
        inputCentsPerMillion: c.inputCentsPerMillion,
        outputCentsPerMillion: c.outputCentsPerMillion,
        reasoning: c.reasoning,
        promptCaching: c.promptCaching,
        supportsTools: c.supportsTools,
        supportsVision: c.supportsVision,
      });
    }
    const config = new Map<string, ModelInfoCapabilities>();
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        config.set(model.id, modelCapabilitiesFromConfig(model));
      }
    }
    const map = new Map<string, ModelInfoCapabilities>();
    for (const id of new Set([...catalog.keys(), ...config.keys()])) {
      const merged = mergeModelCapabilities(config.get(id), catalog.get(id));
      if (merged) map.set(id, merged);
    }
    return map;
  }, [data, providers]);
}
