'use node';

/**
 * Shared helpers for resolving provider models and creating language model instances.
 *
 * Centralizes the resolve → create-provider → get-model pattern used across
 * the codebase, eliminating the repeated type assertions and boilerplate.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  ImageModelV3,
  LanguageModelV3,
  LanguageModelV3Middleware,
} from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';

export interface ResolvedModelData {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  tags: string[];
  dimensions?: number;
  maxOutputTokens?: number;
  supportsStructuredOutputs: boolean;
  imageGenerationMode?: 'images-api' | 'chat-multimodal';
  inputCentsPerMillion?: number;
  outputCentsPerMillion?: number;
  /** For per-image pricing (image-generation models). Complements the token
   * fields above, which remain the cost source for chat/embedding models. */
  imageCentsPerImage?: number;
}

interface ResolvedLanguageModel {
  languageModel: LanguageModelV3;
  modelData: ResolvedModelData;
}

/**
 * Outcome of resolving an image-generation model. Branches on the model's
 * `imageGenerationMode`:
 * - `'images-api'`: uses `/v1/images/generations` via `generateImage()`
 *   (FLUX, Imagen).
 * - `'chat-multimodal'`: uses `/v1/chat/completions` with image parts,
 *   images returned in `result.files` (Nano Banana, GPT-Image).
 */
export type ResolvedImageModel =
  | {
      kind: 'images-api';
      imageModel: ImageModelV3;
      modelData: ResolvedModelData;
    }
  | {
      kind: 'chat-multimodal';
      languageModel: LanguageModelV3;
      modelData: ResolvedModelData;
    };

/**
 * Workaround: Flatten tool inputSchemas that use `oneOf`/`anyOf` at the root.
 *
 * PROBLEM:
 * Many of our agent tools use `z.discriminatedUnion()` (zod v4) for their
 * input schemas. When the AI SDK converts these to JSON Schema, the result
 * is `{ "oneOf": [...] }` — a valid JSON Schema, but OpenAI's API rejects
 * schemas that have `oneOf`/`anyOf`/`allOf` at the top level:
 *
 *   "Invalid schema for function 'rag_search': schema must have type 'object'
 *    and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'not' at the top level."
 *
 * UPSTREAM BUG:
 * This is tracked as vercel/ai#7924. Multiple fix PRs exist (#12283, #12942,
 * #13217) but none have been merged as of 2026-04-10.
 *
 * FIX:
 * We merge all `oneOf`/`anyOf` variant schemas into a single flat object
 * schema. Properties from all variants are combined (all made optional since
 * each variant only uses a subset). The `required` array is set to the
 * intersection of all variants' required fields (typically just the
 * discriminator like `operation`).
 *
 * This preserves the LLM's ability to understand the schema via the tool
 * description while satisfying OpenAI's strict schema requirements.
 *
 * REMOVAL:
 * Delete this middleware once the upstream fix lands in the `ai` package and
 * we upgrade past it.
 *
 * @see https://github.com/vercel/ai/issues/7924
 */

type JSONSchema7Object = Record<string, unknown>;

/**
 * Merge oneOf/anyOf variant schemas into a single flat object schema.
 * All properties become optional except those required by every variant
 * (typically just the discriminator field like `operation`).
 */
function flattenUnionSchema(schema: JSONSchema7Object): JSONSchema7Object {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema oneOf/anyOf are arrays of schema objects
  const variants = (schema.oneOf ?? schema.anyOf) as
    | JSONSchema7Object[]
    | undefined;
  if (!variants || variants.length === 0) return schema;

  const mergedProperties: Record<string, unknown> = {};
  const requiredSets: Set<string>[] = [];
  // Track `const` values per property so we can merge them into `enum`
  const constValues: Record<string, unknown[]> = {};

  for (const variant of variants) {
    if (typeof variant !== 'object' || variant === null) continue;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema properties is Record<string, unknown>
    const props = variant.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        const propObj =
          typeof value === 'object' && value !== null
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check
              (value as Record<string, unknown>)
            : null;

        // Collect `const` values across variants for the same property
        // (e.g., operation: { const: "search" } + operation: { const: "list" }
        //  → operation: { enum: ["search", "list"] })
        if (propObj && 'const' in propObj) {
          if (!constValues[key]) constValues[key] = [];
          constValues[key].push(propObj.const);
        }

        if (!(key in mergedProperties)) {
          mergedProperties[key] = value;
        }
      }
    }

    const req = variant.required;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema required is string[]
    requiredSets.push(new Set(Array.isArray(req) ? (req as string[]) : []));
  }

  // Replace `const` with `enum` for properties that had different const values
  // across variants (typically the discriminator field like "operation")
  for (const [key, values] of Object.entries(constValues)) {
    if (values.length > 1) {
      const existing =
        typeof mergedProperties[key] === 'object' &&
        mergedProperties[key] !== null
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check
            (mergedProperties[key] as Record<string, unknown>)
          : {};
      const { const: _removed, ...rest } = existing;
      mergedProperties[key] = { ...rest, enum: values };
    }
  }

  // Only fields required by ALL variants stay required (usually just the
  // discriminator like "operation")
  const commonRequired =
    requiredSets.length > 0
      ? [...requiredSets[0]].filter((field) =>
          requiredSets.every((s) => s.has(field)),
        )
      : [];

  return {
    type: 'object' as const,
    properties: mergedProperties,
    ...(commonRequired.length > 0 ? { required: commonRequired } : {}),
    additionalProperties: false,
  };
}

const toolSchemaFixMiddleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => {
    if (!params.tools) return params;

    return {
      ...params,
      tools: params.tools.map((tool) => {
        if (tool.type !== 'function') return tool;

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSONSchema7 is a Record-like object
        const schema = tool.inputSchema as JSONSchema7Object | undefined;
        if (!schema) return tool;

        // Only flatten schemas that have oneOf/anyOf at the root — these come
        // from z.discriminatedUnion() / z.union() and are rejected by OpenAI.
        // Schemas that already have type:"object" are left untouched.
        if (schema.oneOf || schema.anyOf) {
          return { ...tool, inputSchema: flattenUnionSchema(schema) };
        }
        return tool;
      }),
    };
  },
};

function createLanguageModel(modelData: ResolvedModelData): LanguageModelV3 {
  const provider = createOpenAICompatible({
    name: modelData.providerName,
    baseURL: modelData.baseUrl,
    apiKey: modelData.apiKey,
    supportsStructuredOutputs: modelData.supportsStructuredOutputs,
  });
  return wrapLanguageModel({
    model: provider.chatModel(modelData.modelId),
    middleware: toolSchemaFixMiddleware,
  });
}

/**
 * Resolve a language model by tag (e.g., 'chat', 'vision').
 * Searches all providers (or a specific one if providerName is given).
 * Pass `orgSlug` to resolve from the caller org's provider files; omit to
 * fall back to the global "default" org (for system-level calls).
 */
export async function resolveLanguageModel(
  ctx: ActionCtx,
  opts: { tag: string; providerName?: string; orgSlug?: string },
): Promise<ResolvedLanguageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelByTag returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelByTag,
    {
      tag: opts.tag,
      providerName: opts.providerName,
      orgSlug: opts.orgSlug,
    },
  )) as ResolvedModelData;
  return { languageModel: createLanguageModel(modelData), modelData };
}

/**
 * Resolve a language model by explicit model ID.
 * Searches all providers (or a specific one if providerName is given).
 * Pass `orgSlug` to resolve from the caller org's provider files; omit to
 * fall back to the global "default" org (for system-level calls).
 */
export async function resolveLanguageModelById(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string; orgSlug?: string },
): Promise<ResolvedLanguageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelData returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelData,
    {
      modelId: opts.modelId,
      providerName: opts.providerName,
      orgSlug: opts.orgSlug,
    },
  )) as ResolvedModelData;
  return { languageModel: createLanguageModel(modelData), modelData };
}

// ---------------------------------------------------------------------------
// Image model resolution
// ---------------------------------------------------------------------------

/**
 * Build a bare image or language model for direct image generation.
 * No middleware is applied — the chat-schema-fix workaround is tool-specific
 * and irrelevant when no tools are passed.
 */
function buildImageResolution(
  modelData: ResolvedModelData,
): ResolvedImageModel {
  const provider = createOpenAICompatible({
    name: modelData.providerName,
    baseURL: modelData.baseUrl,
    apiKey: modelData.apiKey,
  });
  if (modelData.imageGenerationMode === 'chat-multimodal') {
    return {
      kind: 'chat-multimodal',
      languageModel: provider.chatModel(modelData.modelId),
      modelData,
    };
  }
  return {
    kind: 'images-api',
    imageModel: provider.imageModel(modelData.modelId),
    modelData,
  };
}

/**
 * Resolve an image-generation model by explicit model ID.
 * Throws if the resolved model lacks the `'image-generation'` tag.
 */
export async function resolveImageModelById(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string; orgSlug?: string },
): Promise<ResolvedImageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelData returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelData,
    {
      modelId: opts.modelId,
      providerName: opts.providerName,
      orgSlug: opts.orgSlug,
    },
  )) as ResolvedModelData;
  if (!modelData.tags.includes('image-generation')) {
    throw new Error(
      `Model "${modelData.modelId}" lacks the "image-generation" tag.`,
    );
  }
  return buildImageResolution(modelData);
}

/**
 * Resolve the default image-generation model for the org (or first provider
 * that has one). Uses the `defaults['image-generation']` field when set,
 * otherwise falls back to the first model carrying the tag.
 */
export async function resolveImageModelByTag(
  ctx: ActionCtx,
  opts: { providerName?: string; orgSlug?: string } = {},
): Promise<ResolvedImageModel> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelByTag returns v.any() but shape is guaranteed by file_actions contract
  const modelData = (await ctx.runAction(
    internal.providers.file_actions.resolveModelByTag,
    {
      tag: 'image-generation',
      providerName: opts.providerName,
      orgSlug: opts.orgSlug,
    },
  )) as ResolvedModelData;
  return buildImageResolution(modelData);
}
