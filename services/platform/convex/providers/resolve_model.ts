'use node';

/**
 * Shared helpers for resolving provider models and creating language model instances.
 *
 * Centralizes the resolve → create-provider → get-model pattern used across
 * the codebase, eliminating the repeated type assertions and boilerplate.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';

export interface ResolvedModelData {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  dimensions?: number;
  supportsStructuredOutputs: boolean;
}

interface ResolvedLanguageModel {
  languageModel: LanguageModelV3;
  modelData: ResolvedModelData;
}

function createLanguageModel(modelData: ResolvedModelData): LanguageModelV3 {
  const provider = createOpenAICompatible({
    name: modelData.providerName,
    baseURL: modelData.baseUrl,
    apiKey: modelData.apiKey,
    supportsStructuredOutputs: modelData.supportsStructuredOutputs,
  });
  return provider.chatModel(modelData.modelId);
}

/**
 * Resolve a language model by tag (e.g., 'chat', 'vision').
 * Searches all providers (or a specific one if providerName is given).
 */
export async function resolveLanguageModel(
  ctx: ActionCtx,
  opts: { tag: string; providerName?: string },
): Promise<ResolvedLanguageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelByTag returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelByTag,
    { tag: opts.tag, providerName: opts.providerName },
  )) as ResolvedModelData;
  return { languageModel: createLanguageModel(modelData), modelData };
}

/**
 * Resolve a language model by explicit model ID.
 * Searches all providers (or a specific one if providerName is given).
 */
export async function resolveLanguageModelById(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string },
): Promise<ResolvedLanguageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelData returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelData,
    { modelId: opts.modelId, providerName: opts.providerName },
  )) as ResolvedModelData;
  return { languageModel: createLanguageModel(modelData), modelData };
}
