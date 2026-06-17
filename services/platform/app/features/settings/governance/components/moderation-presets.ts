import type {
  ModerationCategoryMapping,
  ModerationResponseShape,
} from '@/lib/shared/schemas/governance';

export interface HeaderRow {
  key: string;
  value: string;
}

// Each preset pre-fills URL / headers / request template for a known
// provider and flips the response shape to the matching built-in adapter.
// The API key itself is entered in the "API key" section below — it's
// AES-encrypted server-side and stored in the `governanceSecrets` table;
// `{{secret}}` in header values is replaced with the decrypted value at
// request time, so the plaintext key never sits in the policy config.
export interface ModerationPreset {
  id: 'openai_moderation' | 'azure_content_safety' | 'perspective';
  url: string;
  headers: HeaderRow[];
  requestTemplate: string;
  // A minimal set of category→label mappings so enabling the provider
  // actually does something without further configuration. Admins can
  // tune modes / thresholds / delete entries after applying.
  defaultMappings: ModerationCategoryMapping[];
}

// All defaults are `flag` mode — detection only, nothing blocked. Admins
// can escalate to mask/block once they've watched Recent Events and are
// confident about false-positive rates on their traffic.
export const MODERATION_PRESETS: ModerationPreset[] = [
  {
    id: 'openai_moderation',
    url: 'https://api.openai.com/v1/moderations',
    headers: [
      { key: 'Authorization', value: 'Bearer {{secret}}' },
      { key: 'Content-Type', value: 'application/json' },
    ],
    requestTemplate: '{"input": {{text}}, "model": "omni-moderation-latest"}',
    defaultMappings: [
      {
        providerCategory: 'harassment',
        internalLabel: 'Harassment',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'hate',
        internalLabel: 'Hate',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'violence',
        internalLabel: 'Violence',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'sexual',
        internalLabel: 'Sexual',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'self-harm',
        internalLabel: 'Self-harm',
        enabled: true,
        mode: 'flag',
      },
    ],
  },
  {
    id: 'azure_content_safety',
    url: 'https://YOUR-RESOURCE.cognitiveservices.azure.com/contentsafety/text:analyze?api-version=2024-09-01',
    headers: [
      { key: 'Ocp-Apim-Subscription-Key', value: '{{secret}}' },
      { key: 'Content-Type', value: 'application/json' },
    ],
    requestTemplate:
      '{"text": {{text}}, "categories": ["Hate","Violence","Sexual","SelfHarm"], "outputType": "FourSeverityLevels"}',
    defaultMappings: [
      {
        providerCategory: 'Hate',
        internalLabel: 'Hate',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'Violence',
        internalLabel: 'Violence',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'Sexual',
        internalLabel: 'Sexual',
        enabled: true,
        mode: 'flag',
      },
      {
        providerCategory: 'SelfHarm',
        internalLabel: 'Self-harm',
        enabled: true,
        mode: 'flag',
      },
    ],
  },
  {
    id: 'perspective',
    url: 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    requestTemplate:
      '{"comment": {"text": {{text}}}, "languages": ["en"], "requestedAttributes": {"TOXICITY": {}, "INSULT": {}, "THREAT": {}, "IDENTITY_ATTACK": {}, "PROFANITY": {}, "SEVERE_TOXICITY": {}}}',
    defaultMappings: [
      {
        providerCategory: 'TOXICITY',
        internalLabel: 'Toxicity',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'SEVERE_TOXICITY',
        internalLabel: 'Severe toxicity',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'THREAT',
        internalLabel: 'Threat',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
      {
        providerCategory: 'IDENTITY_ATTACK',
        internalLabel: 'Identity attack',
        enabled: true,
        mode: 'flag',
        scoreThreshold: 0.7,
      },
    ],
  },
];

export type EndpointDraft = {
  url: string;
  headers: HeaderRow[];
  requestTemplate: string;
  timeoutMs: string;
  customFlaggedPath: string;
  customCategoriesPath: string;
  customCategoryShape: 'array' | 'record_of_bool' | 'record_of_score';
};

export type MappingDraft = ModerationCategoryMapping & {
  scoreThresholdText: string;
};

export function presetLabelKey(id: ModerationPreset['id']): string {
  if (id === 'openai_moderation') return 'moderationProvider.presetOpenai';
  if (id === 'azure_content_safety') return 'moderationProvider.presetAzure';
  return 'moderationProvider.presetPerspective';
}

export function presetActiveLabelKey(id: ModerationPreset['id']): string {
  if (id === 'openai_moderation')
    return 'moderationProvider.presetOpenaiActive';
  if (id === 'azure_content_safety')
    return 'moderationProvider.presetAzureActive';
  return 'moderationProvider.presetPerspectiveActive';
}

export function presetNoteKey(id: ModerationPreset['id']): string | null {
  if (id === 'azure_content_safety')
    return 'moderationProvider.presetAzureNote';
  if (id === 'perspective') return 'moderationProvider.presetPerspectiveNote';
  return null;
}

export type CustomCategoryShape =
  | 'array'
  | 'record_of_bool'
  | 'record_of_score';

export interface ModerationDraft {
  enabled: boolean;
  appliesToInput: boolean;
  appliesToOutput: boolean;
  url: string;
  headers: HeaderRow[];
  requestTemplate: string;
  timeoutMs: string;
  responseShape: ModerationResponseShape['type'];
  customFlaggedPath: string;
  customCategoriesPath: string;
  customCategoryShape: CustomCategoryShape;
  failInput: 'open' | 'closed';
  failOutput: 'open' | 'closed';
  mappings: ModerationCategoryMapping[];
}

export const DEFAULT_DRAFT: ModerationDraft = {
  enabled: false,
  appliesToInput: true,
  appliesToOutput: false,
  url: '',
  headers: [],
  requestTemplate: '',
  timeoutMs: '3000',
  responseShape: 'openai_moderation',
  customFlaggedPath: '',
  customCategoriesPath: '',
  customCategoryShape: 'record_of_bool',
  failInput: 'open',
  failOutput: 'closed',
  mappings: [],
};
