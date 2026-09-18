import { useMemo } from 'react';

import {
  useProviderCatalogs,
  useProviderCredentials,
} from '@/app/features/settings/providers/hooks/queries';
import type { ModelInfoCapabilities } from '@/app/features/shared/models/model-info-popover';

/**
 * The provider/model catalog the governance model-policy editors (default
 * models, model access) read to fill their provider and model pickers.
 *
 * These editors used to read a catalog that went offline during the
 * 2026-08 AI-backend rewrite (#2857), and the reads were left as empty
 * stubs — so the pickers showed "No providers found" no matter how many
 * credentials the organization had configured (2026-09-18). The catalog is
 * back and already powers the AI-providers settings page; this reconnects
 * the governance editors to the same live source
 * (`useProviderCatalogs`), shaped to what the editors narrow, and scoped to
 * the providers the organization actually authenticates with so a default
 * rule can never point at a provider that could not serve it.
 */

/**
 * Loose provider record the editors narrow field by field — kept for the
 * shape they already consume (`name`, `displayName`, `models`).
 */
export interface CatalogProviderRecord {
  name: string;
  displayName?: string;
  models?: unknown;
  [key: string]: unknown;
}

const EMPTY_PROVIDERS: CatalogProviderRecord[] = [];
const EMPTY_CAPABILITIES = new Map<string, ModelInfoCapabilities>();

/**
 * Every provider the organization can authenticate with, each carrying its
 * model catalog. A provider with no active credential is omitted: a
 * default-model or access rule pointing at it could never serve, and the
 * Providers settings page shows the same set.
 */
export function useListProviders(organizationId: string): {
  providers: CatalogProviderRecord[];
  isLoading: boolean;
} {
  const { data: catalogs, isLoading: catalogsLoading } =
    useProviderCatalogs(organizationId);
  const { data: credentials, isLoading: credentialsLoading } =
    useProviderCredentials(organizationId);

  const providers = useMemo<CatalogProviderRecord[]>(() => {
    if (!catalogs || catalogs.length === 0) return EMPTY_PROVIDERS;
    const configured = new Set(
      (credentials ?? [])
        .filter((credential) => credential.status === 'active')
        .map((credential) => credential.providerSlug),
    );
    const list = catalogs
      .filter((provider) => configured.has(provider.name))
      .map<CatalogProviderRecord>((provider) => ({
        name: provider.name,
        displayName: provider.displayName,
        // The catalog keys models by `id`; there is no separate label, so the
        // id is the display name (the editors fall back to it anyway).
        models: provider.models.map((model) => ({
          id: model.id,
          displayName: model.id,
          tags: model.tags,
        })),
      }));
    return list.length === 0 ? EMPTY_PROVIDERS : list;
  }, [catalogs, credentials]);

  return { providers, isLoading: catalogsLoading || credentialsLoading };
}

/**
 * The catalog capabilities (cost, context window, reasoning, tools, vision)
 * for the requested model ids — what the model-info popover renders beside a
 * pickable model. Absent ids and unknown fields are simply omitted.
 */
export function useModelCapabilities(
  organizationId: string,
  modelIds: string[],
): Map<string, ModelInfoCapabilities> {
  const { data: catalogs } = useProviderCatalogs(organizationId);
  // A fresh array reaches this hook each render; key the memo on the ids'
  // content (a primitive) so the returned Map keeps a stable identity.
  const wantedKey = modelIds.join('\n');

  return useMemo(() => {
    if (!catalogs || modelIds.length === 0) return EMPTY_CAPABILITIES;
    const wanted = new Set(modelIds);
    const map = new Map<string, ModelInfoCapabilities>();
    for (const provider of catalogs) {
      for (const model of provider.models) {
        if (!wanted.has(model.id) || map.has(model.id)) continue;
        map.set(model.id, {
          contextWindow: model.contextWindow,
          ...(model.maxOutputTokens !== undefined
            ? { maxOutputTokens: model.maxOutputTokens }
            : {}),
          ...(model.pricing !== undefined
            ? {
                inputCentsPerMillion: model.pricing.inputCentsPerMillion,
                outputCentsPerMillion: model.pricing.outputCentsPerMillion,
              }
            : {}),
          ...(model.reasoning !== undefined
            ? { reasoning: { knob: model.reasoning.knob } }
            : {}),
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
        });
      }
    }
    return map.size === 0 ? EMPTY_CAPABILITIES : map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wantedKey is the content of modelIds
  }, [catalogs, wantedKey]);
}
