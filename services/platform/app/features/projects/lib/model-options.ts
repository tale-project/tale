/**
 * The (provider, model) picker vocabulary shared by every surface that saves
 * a pinned model pick — the project-agent dialog and the automation agent
 * node. One option per (provider, model) pair, exactly as the composer
 * listing carries them: the pick stores the PAIR (`model` + `modelProvider`),
 * so two providers serving the same id stay separately pickable — collapsing
 * them was how a pick silently landed on the wrong provider's bill.
 */

/** One (provider, model) pair the agent can call — a composer model listing
 * entry. The same model id can appear once per provider that serves it. */
export interface ModelOption {
  id: string;
  label: string;
  providerSlug: string;
  /** The provider's human name, shown under each option. */
  providerLabel: string;
  /** Present when a subscription credential serves this entry — usable only
   * by its forced harness, so the picker offers it for that harness alone. */
  subscription?: { harness: string };
}

/** A `listComposerModels` row, narrowed to the fields the mapping reads. */
export interface ComposerModelListingRow {
  id: string;
  label: string;
  providerSlug: string;
  providerLabel: string;
  credential:
    | { authMethod: 'api-key' | 'env' }
    | {
        authMethod: 'subscription-key' | 'subscription-broker';
        constraints: { harness: string };
      };
}

/** Listing rows → picker options, subscription-served entries carrying the
 * harness that may drive them. */
export function toModelOptions(
  rows: readonly ComposerModelListingRow[],
): ModelOption[] {
  return rows.map((row) => {
    const option: ModelOption = {
      id: row.id,
      label: row.label,
      providerSlug: row.providerSlug,
      providerLabel: row.providerLabel,
    };
    if (
      row.credential.authMethod === 'subscription-key' ||
      row.credential.authMethod === 'subscription-broker'
    ) {
      option.subscription = { harness: row.credential.constraints.harness };
    }
    return option;
  });
}

/** The offered option matching a saved pick: the exact (provider, id) pair,
 * and nothing looser. A pinless legacy pick deliberately matches NOTHING
 * here — an id-alone fallback used to preselect whichever provider happened
 * to share the id, asserting a provider the run's walk might not use. The
 * pickers render a pinless pick from the runtime's own resolution preview
 * instead, so what is shown is what would actually serve. */
export function findSelectedModel(
  options: readonly ModelOption[],
  model: string,
  modelProvider: string,
): ModelOption | undefined {
  if (model === '' || modelProvider === '') return undefined;
  return options.find(
    (option) => option.id === model && option.providerSlug === modelProvider,
  );
}
