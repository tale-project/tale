/**
 * `lib` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../lib.ts` are what
 * actually serve them.
 */

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
      models: Array<{
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
      }>;
      endpointMode?: 'fixed' | 'per-credential';
      baseUrl?: string;
      apiFormat: 'openai' | 'anthropic';
      iconUrl?: string;
      name: string;
      displayName: string;
    }>;
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
}
