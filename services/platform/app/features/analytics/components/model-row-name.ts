import {
  modelName,
  qualifiedModelName,
  sharedModelNames,
} from '@/app/features/shared/models/model-name';

/** A model a metrics row names, and the provider that served it (`null` or
 * `''` where the row recorded none: a verdict or turn stored before rows
 * named providers, or a turn whose lane knew none). */
export interface ModelRow {
  readonly model: string;
  readonly provider: string | null;
}

function providerOf(row: ModelRow): string | null {
  return row.provider === null || row.provider === '' ? null : row.provider;
}

/**
 * Names the models in one list of metrics rows by the shared rule
 * (`shared/models/model-name.ts`): `provider · model` where the list holds
 * the model through another provider too, the model's id otherwise. A row
 * recorded without a provider counts as a provider of its own and keeps its
 * id, so `openrouter · luna` stays apart from an old `luna`.
 */
export function modelRowNames(
  rows: readonly ModelRow[],
): (row: ModelRow) => string {
  const shared = sharedModelNames(
    rows.map((row) => ({ id: row.model, providerSlug: providerOf(row) ?? '' })),
  );
  return (row) => {
    const provider = providerOf(row);
    return provider === null
      ? row.model
      : modelName({ id: row.model, providerSlug: provider }, shared);
  };
}

/** `provider · model` whenever the provider is known, the model's id
 * otherwise: what a model filter's chip says (the filter narrows to that
 * provider's traffic alone, whatever else the page lists) and what a hover
 * title spells out in full. */
export function providedModelName(
  model: string,
  provider?: string | null,
): string {
  return provider === undefined || provider === null || provider === ''
    ? model
    : qualifiedModelName({ id: model, providerSlug: provider });
}
