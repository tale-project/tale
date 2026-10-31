import { useMemo } from 'react';

import {
  useProviderCatalogs,
  useProviderCredentials,
} from '@/app/features/settings/providers/hooks/queries';
import type { ModelInfoCapabilities } from '@/app/features/shared/models/model-info-popover';
import type { HiddenModelsRule } from '@/app/lib/backend/contract/lib';

import { stripQualifier } from '../components/model-id';

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
  /** The EU/EEA processing rule refuses a call through the provider's
   * default credential (GOV-R22); absent while the rule is off. */
  endpointRefusedBy?: HiddenModelsRule;
  [key: string]: unknown;
}

/**
 * The model ids each provider with an active credential offers, by provider
 * name: what tells a stored rule entry that still names a model the
 * organization can use from one a removed provider left behind.
 */
export type OfferedModels = ReadonlyMap<string, ReadonlySet<string>>;

const EMPTY_PROVIDERS: CatalogProviderRecord[] = [];
const EMPTY_CAPABILITIES = new Map<string, ModelInfoCapabilities>();

function activeProviderSlugs(
  credentials: readonly { providerSlug: string; status: string }[],
): Set<string> {
  return new Set(
    credentials
      .filter((credential) => credential.status === 'active')
      .map((credential) => credential.providerSlug),
  );
}

/**
 * Every provider the organization can authenticate with, each carrying its
 * model catalog. A provider with no active credential is omitted: a
 * default-model or access rule pointing at it could never serve, and the
 * Providers settings page shows the same set. `offered` is the same set as
 * model ids, and `null` while it is unknown — a read is loading or failed,
 * or a configured provider's catalog could not be listed (its models are
 * unknown, not gone) — so no entry is marked unavailable on a guess.
 */
export function useListProviders(organizationId: string): {
  providers: CatalogProviderRecord[];
  offered: OfferedModels | null;
  isLoading: boolean;
} {
  const { data: catalogs, isLoading: catalogsLoading } =
    useProviderCatalogs(organizationId);
  const { data: credentials, isLoading: credentialsLoading } =
    useProviderCredentials(organizationId);

  const providers = useMemo<CatalogProviderRecord[]>(() => {
    if (!catalogs || catalogs.length === 0) return EMPTY_PROVIDERS;
    const configured = activeProviderSlugs(credentials ?? []);
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
          supportsTools: model.supportsTools,
          outputsMedia: model.outputsMedia === true,
        })),
        endpointRefusedBy: provider.endpointRefusedBy,
      }));
    return list.length === 0 ? EMPTY_PROVIDERS : list;
  }, [catalogs, credentials]);

  const offered = useMemo<OfferedModels | null>(() => {
    if (!catalogs || !credentials) return null;
    const configured = activeProviderSlugs(credentials);
    const listed = catalogs.filter((provider) => configured.has(provider.name));
    if (listed.some((provider) => provider.catalogError !== undefined)) {
      return null;
    }
    return new Map(
      listed.map((provider) => [
        provider.name,
        new Set(provider.models.map((model) => model.id)),
      ]),
    );
  }, [catalogs, credentials]);

  return {
    providers,
    offered,
    isLoading: catalogsLoading || credentialsLoading,
  };
}

/**
 * Whether some provider with an active credential, other than
 * `exceptProvider`, offers the model a model access entry names — compared
 * without a provider qualifier, as the access check compares them.
 */
export function isAccessEntryOffered(
  offered: OfferedModels,
  entry: string,
  exceptProvider?: string,
): boolean {
  const plain = stripQualifier(entry);
  for (const [provider, models] of offered) {
    if (provider === exceptProvider) continue;
    for (const id of models) {
      if (stripQualifier(id) === plain) return true;
    }
  }
  return false;
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
