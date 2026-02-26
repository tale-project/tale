/**
 * Embedding Dimension Configuration
 *
 * Reads EMBEDDING_DIMENSIONS env var to determine which vector table to use
 * and injects the dimensions parameter into embedding API calls.
 * Supports: 256, 512, 1024, 1536 (default), 2048, 2560, 4096.
 */

import type { EmbeddingModelV2 } from '@ai-sdk/provider';
import type { TableNamesInDataModel } from 'convex/server';

import type { DataModel } from '../_generated/dataModel';

import { getEnvOrThrow, getEnvWithDefault } from './get_or_throw';
import { openai } from './openai_provider';

export const SUPPORTED_DIMENSIONS = [
  256, 512, 1024, 1536, 2048, 2560, 4096,
] as const;

export type SupportedDimension = (typeof SUPPORTED_DIMENSIONS)[number];

const DIMENSION_TO_TABLE: Record<
  SupportedDimension,
  TableNamesInDataModel<DataModel>
> = {
  256: 'websitePageEmbeddings256',
  512: 'websitePageEmbeddings512',
  1024: 'websitePageEmbeddings1024',
  1536: 'websitePageEmbeddings1536',
  2048: 'websitePageEmbeddings2048',
  2560: 'websitePageEmbeddings2560',
  4096: 'websitePageEmbeddings4096',
};

function isSupportedDimension(value: number): value is SupportedDimension {
  return (SUPPORTED_DIMENSIONS as readonly number[]).includes(value);
}

export function getEmbeddingDimension(): SupportedDimension {
  const raw = getEnvWithDefault('EMBEDDING_DIMENSIONS', '1536');
  const parsed = parseInt(raw, 10);
  if (!isSupportedDimension(parsed)) {
    throw new Error(
      `[Embedding] Invalid EMBEDDING_DIMENSIONS="${raw}". ` +
        `Supported: ${SUPPORTED_DIMENSIONS.join(', ')}`,
    );
  }
  return parsed;
}

export function getEmbeddingTableName(): TableNamesInDataModel<DataModel> {
  return DIMENSION_TO_TABLE[getEmbeddingDimension()];
}

export function getRecommendedEmbeddingModel(): string {
  return getEnvOrThrow(
    'OPENAI_EMBEDDING_MODEL',
    'Embedding model name (e.g. text-embedding-3-small)',
  );
}

export function getTextEmbeddingModel(): EmbeddingModelV2<string> {
  const model = openai.embedding(getRecommendedEmbeddingModel());
  return withDimensions(model, getEmbeddingDimension());
}

/**
 * Wraps an embedding model to inject `dimensions` into every API call
 * via `providerOptions.openai.dimensions`.
 *
 * This is necessary because the `@ai-sdk/openai` `embedding()` factory
 * does not accept a dimensions setting, and `@convex-dev/agent`'s
 * `embedMany` only forwards `callSettings` (which excludes providerOptions).
 * Wrapping at the model level ensures every `doEmbed` call carries the
 * configured dimension regardless of the calling code.
 */
export function withDimensions(
  model: EmbeddingModelV2<string>,
  dimensions: number,
): EmbeddingModelV2<string> {
  const originalDoEmbed = model.doEmbed.bind(model);
  return {
    specificationVersion: model.specificationVersion,
    modelId: model.modelId,
    get provider() {
      return model.provider;
    },
    maxEmbeddingsPerCall: model.maxEmbeddingsPerCall,
    supportsParallelCalls: model.supportsParallelCalls,
    doEmbed(options: Parameters<EmbeddingModelV2<string>['doEmbed']>[0]) {
      return originalDoEmbed({
        ...options,
        providerOptions: {
          ...options.providerOptions,
          openai: {
            ...options.providerOptions?.openai,
            dimensions,
          },
        },
      });
    },
  };
}
