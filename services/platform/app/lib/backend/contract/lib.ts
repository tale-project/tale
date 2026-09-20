/**
 * `lib` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../lib.ts` are what
 * actually serve them.
 */

import type { ProviderDefinition } from '@tale/shared/schemas/providers';

/** One normalized model entry of a provider catalog. */
export interface ProviderCatalogModel {
  embedding?: { recommended?: boolean; dimensions: number };
  tts?: {
    defaultVoice?: string;
    voicesByLocale?: Record<string, string>;
    defaultInstructions?: string;
    instructionsByLocale?: Record<string, string>;
    centsPerMillionCharacters?: number;
    audioFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  };
  reasoning?: {
    off?: 'low' | 'none' | 'minimal';
    toolsRequireOff?: boolean;
    knob: 'effort' | 'budget-tokens';
  };
  outputsMedia?: boolean;
  maxOutputTokens?: number;
  pricing?: {
    inputCentsPerMillion: number;
    outputCentsPerMillion: number;
  };
  id: string;
  provider: string;
  tags: string[];
  supportsTools: boolean;
  supportsVision: boolean;
  contextWindow: number;
}

/**
 * An organization's custom provider definition as the settings surface reads
 * and writes it: the native config plus the hash the next write must name
 * (`null` for a definition that does not exist yet).
 */
export interface ProviderDefinitionSnapshot {
  config: ProviderDefinition | null;
  hash: string | null;
}

export interface LibContract {
  'lib/providers/catalog_actions:listProviderCatalogs': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<{
      catalogError?: string;
      catalogSource: 'none' | 'static' | 'openrouter-api' | 'models-endpoint';
      authMethods: Array<
        'api-key' | 'env' | 'subscription-key' | 'subscription-broker'
      >;
      models: ProviderCatalogModel[];
      endpointMode?: 'fixed' | 'per-credential';
      baseUrl?: string;
      apiFormat: 'openai' | 'anthropic';
      iconUrl?: string;
      name: string;
      displayName: string;
      /** Shipped with the platform image, or defined by this organization. */
      origin?: 'shipped' | 'organization';
    }>;
  };
  'lib/providers/definition_actions:getProviderDefinition': {
    kind: 'action';
    args: { organizationId: string; name: string };
    returns: ProviderDefinitionSnapshot;
  };
  'lib/providers/definition_actions:saveProviderDefinition': {
    kind: 'action';
    args: {
      organizationId: string;
      name: string;
      config: ProviderDefinition;
      /** The hash the definition was loaded with; `null` creates it. */
      expectedHash: string | null;
    };
    returns: ProviderDefinitionSnapshot;
  };
  'lib/providers/definition_actions:deleteProviderDefinition': {
    kind: 'action';
    args: { organizationId: string; name: string; expectedHash?: string };
    returns: null;
  };
  'lib/providers/definition_actions:checkProviderDefinitionCatalog': {
    kind: 'action';
    args: { organizationId: string; name: string };
    returns: ProviderCatalogModel[];
  };
  'lib/providers/catalog_actions:refreshProviderCatalogs': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<
      | { name: string; modelCount: number; error?: undefined }
      | { name: string; modelCount: number; error: string }
    >;
  };
  'lib/providers/harness_status:listHarnessStatus': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<{
      subscriptions: Array<{ providerSlug: string; usable: boolean }>;
      slug: string;
      label: string;
      managed:
        | { modelCount: number; available: true; defaultModelId: string }
        | { reason: 'no-direct-credential'; available: false };
    }>;
  };
  'lib/providers/vision_actions:getResolvedVisionModel': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | {
      providerSlug: string;
      modelId: string;
      source: 'pinned' | 'preferred' | 'cheapest';
    };
  };
  'lib/providers/transcription_actions:getTranscriptionModelState': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      models: Array<{
        providerSlug: string;
        providerDisplayName: string;
        modelId: string;
      }>;
      pick: {
        providerSlug: string;
        modelId: string;
        source: 'automatic' | 'pinned';
      } | null;
      error?: { code: string };
    };
  };
}
