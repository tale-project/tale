import type { Sql } from 'postgres';

import { pickReplacementModel } from '../../../lib/automations/model-defaults.ts';
import type { ChatChoiceEntry } from '../../../lib/chat/model-choice.ts';
import { listOrganizationChatModels } from '../chat/composer.ts';
import { walkLlmServingForOrganization } from './llm-serving.ts';
import { withinBudget } from './within-budget.ts';

/** How long one model's serving walk may take before the model stays: the
 * walk reads live provider catalogs. */
const SERVING_BUDGET_MS = 5_000;

/** How long the organization's model listing may take before every model
 * stays. */
const LISTING_BUDGET_MS = 10_000;

/**
 * The models an `llm` step of a document the organization did not write
 * should use instead of the ones it names — keyed by the model named, for
 * `applyModelDefaults` — when the organization does not serve them.
 *
 * A model is replaced only when the run's own serving walk says no direct
 * provider of the organization serves it. When the walk cannot tell — a
 * provider's catalog could not be read, or the walk ran out of time — the
 * model stays: a provider that is down for a minute must not rewrite a
 * shipped pack for good. The replacement is the chat Auto's pick for the
 * model's band among the models the organization serves directly (an API
 * key or the deployment's environment, as a run serves an `llm` step) and
 * lets every member use. Whatever fails leaves the model as it is.
 */
export async function resolveModelReplacements(
  sql: Sql,
  organizationId: string,
  models: readonly string[],
): Promise<Map<string, string>> {
  const replacements = new Map<string, string>();
  let candidates: ChatChoiceEntry[] | null = null;
  for (const model of new Set(models)) {
    try {
      const walk = await withinBudget(
        SERVING_BUDGET_MS,
        () => walkLlmServingForOrganization(sql, organizationId, model),
        `the serving of ${model}`,
      );
      if (
        walk === undefined ||
        walk.target !== null ||
        walk.unreachable.length > 0
      ) {
        continue;
      }
      candidates ??=
        (await withinBudget(
          LISTING_BUDGET_MS,
          () => directChoices(sql, organizationId),
          "the organization's models",
        )) ?? [];
      const pick = pickReplacementModel(model, candidates);
      if (pick !== null) replacements.set(model, pick.id);
    } catch (error) {
      console.warn(
        `[automations] kept model ${model}: its replacement could not be chosen`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return replacements;
}

/** The models the organization serves directly, as the Auto pick reads
 * them. */
async function directChoices(
  sql: Sql,
  organizationId: string,
): Promise<ChatChoiceEntry[]> {
  const options = await listOrganizationChatModels(sql, organizationId);
  return options
    .filter(
      (option) =>
        option.credential.authMethod === 'api-key' ||
        option.credential.authMethod === 'env',
    )
    .map((option) => {
      const entry: ChatChoiceEntry = {
        id: option.id,
        provider: option.providerSlug,
        tags: [...option.tags],
        supportsTools: option.tools,
        supportsVision: option.vision === true,
      };
      if (option.pricing !== undefined) entry.pricing = option.pricing;
      return entry;
    });
}
