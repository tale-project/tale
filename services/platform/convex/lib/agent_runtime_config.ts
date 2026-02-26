import {
  getFirstModel,
  getFirstModelOrThrow,
} from '../../lib/shared/utils/model-list';

/**
 * Get the first standard model from OPENAI_MODEL.
 */
export function getDefaultModel(): string {
  return getFirstModelOrThrow(process.env.OPENAI_MODEL, 'OPENAI_MODEL');
}

/**
 * Get the first fast model from OPENAI_FAST_MODEL.
 */
export function getFastModel(): string {
  return getFirstModelOrThrow(
    process.env.OPENAI_FAST_MODEL,
    'OPENAI_FAST_MODEL',
  );
}

/**
 * Get the first coding/advanced model from OPENAI_CODING_MODEL, or undefined.
 */
export function getCodingModel(): string | undefined {
  return getFirstModel(process.env.OPENAI_CODING_MODEL);
}

/**
 * Get the first coding/advanced model from OPENAI_CODING_MODEL, or throw.
 */
export function getCodingModelOrThrow(): string {
  return getFirstModelOrThrow(
    process.env.OPENAI_CODING_MODEL,
    'OPENAI_CODING_MODEL',
  );
}

export function getDefaultAgentRuntimeConfig() {
  return {
    model: getDefaultModel(),
    provider: 'openai' as const,
  };
}
