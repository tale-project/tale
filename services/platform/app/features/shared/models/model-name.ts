/**
 * How a model is named where a person picks it or reads about it.
 *
 * A model id is not unique within an organization: two providers can list
 * the same id (OpenRouter's catalog and an OpenAI-compatible gateway both
 * name `openai/gpt-5.6-luna`), two ids can read alike (OpenAI's
 * `gpt-5.6-luna` is "GPT 5.6 Luna" too), and a pick is the (provider,
 * model) pair. So a name that stands alone (a closed picker, a status line,
 * an automation's node) leads with the provider whenever another provider in
 * the same list offers the id or a model of the same name, and is the
 * model's own name otherwise. An open list groups its models under their
 * providers instead: each row shows the model's own name, and reads its
 * provider to assistive technology, which hears no header.
 */

import type { SearchableSelectOption } from '@tale/ui/searchable-select';

/** Between a provider and its model, in a name that stands alone. */
const MODEL_NAME_SEPARATOR = ' · ';

/** A model as one provider offers it. */
export interface ProvidedModel {
  readonly id: string;
  readonly providerSlug: string;
  /** The model's display name; the id stands in when it is absent. */
  readonly label?: string;
  /** The provider's display name; the slug stands in when it is absent. */
  readonly providerLabel?: string;
}

/** The model's own name: its display name, or its id. */
function ownName(model: Pick<ProvidedModel, 'id' | 'label'>): string {
  return model.label || model.id;
}

/** The provider's own name: its display name, or its slug. */
function providerName(
  model: Pick<ProvidedModel, 'providerSlug' | 'providerLabel'>,
): string {
  return model.providerLabel || model.providerSlug;
}

/** What more than one provider in a list offers. */
export interface SharedNames {
  readonly ids: ReadonlySet<string>;
  /** Models' own names, which ids that differ can share. */
  readonly names: ReadonlySet<string>;
}

/** The ids and the models' own names that more than one provider in
 * `models` offers. One provider listing either twice counts once: its name
 * would not tell the two apart. */
export function sharedModelNames(
  models: readonly ProvidedModel[],
): SharedNames {
  const sharedBy = (key: (model: ProvidedModel) => string) => {
    const providers = new Map<string, Set<string>>();
    for (const model of models) {
      const slugs = providers.get(key(model)) ?? new Set<string>();
      slugs.add(model.providerSlug);
      providers.set(key(model), slugs);
    }
    return new Set(
      [...providers].filter(([, slugs]) => slugs.size > 1).map(([k]) => k),
    );
  };
  return { ids: sharedBy((model) => model.id), names: sharedBy(ownName) };
}

function qualified(provider: string, own: string): string {
  return `${provider}${MODEL_NAME_SEPARATOR}${own}`;
}

/** `Provider · model`: what `model` is called where nothing around it names
 * its provider, such as a row under its provider's header to assistive
 * technology, or a saved pick that no provider offers any more. */
export function qualifiedModelName(model: ProvidedModel): string {
  return qualified(providerName(model), ownName(model));
}

/**
 * What `model` is called where it stands alone: `Provider · model` when
 * another provider in its list offers the same id or a model of the same
 * name, the model's own name otherwise. `shared` is `sharedModelNames` of
 * that list.
 */
export function modelName(model: ProvidedModel, shared: SharedNames): string {
  return shared.ids.has(model.id) || shared.names.has(ownName(model))
    ? qualifiedModelName(model)
    : ownName(model);
}

/**
 * What a pick is called where it stands alone (a closed picker, a status
 * line, a node on the canvas), among the `models` its picker offers: as
 * `modelName` names the row that offers it. A pick that no row of its
 * provider offers takes its model's name from a row with its id (the same
 * id is the same model), and leads with its provider when another provider
 * offers that id or a model of that name.
 */
export function pickedModelName(
  pick: ProvidedModel,
  models: readonly ProvidedModel[],
): string {
  const row = models.find(
    (model) => model.id === pick.id && model.providerSlug === pick.providerSlug,
  );
  if (row !== undefined) return modelName(row, sharedModelNames(models));
  const own =
    pick.label ||
    models.find((model) => model.id === pick.id)?.label ||
    pick.id;
  const offeredElsewhere = models.some(
    (model) =>
      model.providerSlug !== pick.providerSlug &&
      (model.id === pick.id || ownName(model) === own),
  );
  if (!offeredElsewhere) return own;
  const provider =
    pick.providerLabel ||
    models.find((model) => model.providerSlug === pick.providerSlug)
      ?.providerLabel ||
    pick.providerSlug;
  return qualified(provider, own);
}

/** One provider's models, in the order its list offers them. */
export interface ProviderGroup<T extends ProvidedModel> {
  readonly providerSlug: string;
  readonly providerLabel: string;
  readonly models: readonly T[];
}

/** `models` by provider: the providers in the order they first appear,
 * each one's models in list order. */
export function groupByProvider<T extends ProvidedModel>(
  models: readonly T[],
): ProviderGroup<T>[] {
  const groups = new Map<
    string,
    { providerSlug: string; providerLabel: string; models: T[] }
  >();
  for (const model of models) {
    const group = groups.get(model.providerSlug);
    if (group === undefined) {
      groups.set(model.providerSlug, {
        providerSlug: model.providerSlug,
        providerLabel: providerName(model),
        models: [model],
      });
    } else {
      group.models.push(model);
    }
  }
  return [...groups.values()];
}

/** What a picker gives a model's row: its value, and any description or
 * state. The model gives the row its label, names and keywords. */
export type ModelRowOption = Omit<
  SearchableSelectOption,
  'label' | 'name' | 'selectedLabel' | 'keywords' | 'isSectionHeader'
>;

/**
 * The `SearchableSelect` options of a model pick: a header per provider,
 * then its models. Each row shows the model's own name and reads
 * `Provider · model` to assistive technology, and the closed picker shows
 * the name it stands alone by (`modelName`). Both names, the provider's
 * slug and the model id are searchable. `optionOf` receives the model's
 * index in `models`, for a picker whose values are indices.
 *
 * Rows a picker shows outside any provider (Automatic, a saved pick no
 * longer offered) go BEFORE these: every row after a header belongs to that
 * header's section.
 */
export function modelOptionsByProvider<T extends ProvidedModel>(
  models: readonly T[],
  optionOf: (model: T, index: number) => ModelRowOption,
): SearchableSelectOption[] {
  const shared = sharedModelNames(models);
  const indices = new Map(models.map((model, index) => [model, index]));
  const options: SearchableSelectOption[] = [];
  for (const group of groupByProvider(models)) {
    options.push({
      value: `header:${group.providerSlug}`,
      label: group.providerLabel,
      isSectionHeader: true,
    });
    for (const model of group.models) {
      options.push({
        ...optionOf(model, indices.get(model) ?? -1),
        label: ownName(model),
        name: qualifiedModelName(model),
        selectedLabel: modelName(model, shared),
        keywords: [model.providerSlug, model.id],
      });
    }
  }
  return options;
}
