import { type modelTagLiterals } from '../schemas/providers';

type ModelTag = (typeof modelTagLiterals)[number];

/** Fixed identity the onboarding wizard creates the OpenRouter provider under. */
export const OPENROUTER_PROVIDER_NAME = 'openrouter';
export const OPENROUTER_DISPLAY_NAME = 'OpenRouter';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Where the wizard sends users who don't have a key yet. */
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';

interface RecommendedModel {
  id: string;
  displayName: string;
  tags: ModelTag[];
}

/**
 * Curated default models the onboarding wizard pre-configures when the user
 * connects OpenRouter, so chat, vision and image generation/editing work the
 * moment setup finishes — no manual model tagging required.
 *
 * IDs are intersected with OpenRouter's live `/models` response before saving
 * (see the OpenRouter onboarding step), so an entry that OpenRouter retires is
 * silently dropped rather than persisting a dead model. Keep this list short
 * and current; it is guidance, not an exhaustive catalogue.
 */
export const RECOMMENDED_OPENROUTER_MODELS: RecommendedModel[] = [
  {
    id: 'anthropic/claude-opus-4.8',
    displayName: 'Claude Opus 4.8',
    tags: ['chat', 'vision'],
  },
  {
    id: 'openai/gpt-5.5',
    displayName: 'GPT-5.5',
    tags: ['chat', 'vision'],
  },
  {
    id: 'google/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    tags: ['chat', 'vision'],
  },
  {
    id: 'google/gemini-2.5-flash-image',
    displayName: 'Nano Banana (Gemini 2.5 Flash Image)',
    tags: ['image-generation', 'image-edit'],
  },
  {
    id: 'openai/gpt-5-image',
    displayName: 'GPT-5 Image',
    tags: ['image-generation', 'image-edit'],
  },
];
