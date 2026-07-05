import type { ModelInfoCapabilities } from '@/app/features/chat/components/model-info-popover';
import type { ModelDefinition } from '@/lib/shared/schemas/providers';

/**
 * Project the model-info-popover capability fields an operator can declare
 * directly in a provider's org-config `ModelDefinition`. The synced catalog
 * cache is the richer source, but these operator-declared fields are
 * authoritative and available before the first catalog sync — so the popover
 * can still render them pre-sync (issue #2357).
 *
 * `supportsVision` is derived from the `'vision'` tag (never asserted `false`
 * from a tag's absence, so the catalog can still fill it). `supportsTools` has
 * no org-config field and is left entirely to the catalog.
 */
export function modelCapabilitiesFromConfig(
  model: Pick<
    ModelDefinition,
    | 'tags'
    | 'maxOutputTokens'
    | 'contextWindow'
    | 'reasoning'
    | 'promptCaching'
    | 'cost'
  >,
): ModelInfoCapabilities {
  return {
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputCentsPerMillion: model.cost?.inputCentsPerMillion,
    outputCentsPerMillion: model.cost?.outputCentsPerMillion,
    reasoning: model.reasoning,
    promptCaching: model.promptCaching,
    supportsVision: model.tags.includes('vision') ? true : undefined,
  };
}

/**
 * Merge operator-declared org-config capabilities with synced catalog
 * metadata. Operator declarations win per field — they are intentional, and
 * the runtime already honours `reasoning`/`promptCaching` overrides — while
 * the catalog fills every field the config leaves undefined. Either side may
 * be absent: there is no catalog before the first sync, and most models
 * declare nothing.
 */
export function mergeModelCapabilities(
  config: ModelInfoCapabilities | undefined,
  catalog: ModelInfoCapabilities | undefined,
): ModelInfoCapabilities | undefined {
  if (!config) return catalog;
  if (!catalog) return config;
  return {
    contextWindow: config.contextWindow ?? catalog.contextWindow,
    maxOutputTokens: config.maxOutputTokens ?? catalog.maxOutputTokens,
    inputCentsPerMillion:
      config.inputCentsPerMillion ?? catalog.inputCentsPerMillion,
    outputCentsPerMillion:
      config.outputCentsPerMillion ?? catalog.outputCentsPerMillion,
    reasoning: config.reasoning ?? catalog.reasoning,
    promptCaching: config.promptCaching ?? catalog.promptCaching,
    supportsTools: config.supportsTools ?? catalog.supportsTools,
    supportsVision: config.supportsVision ?? catalog.supportsVision,
  };
}
