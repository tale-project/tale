import {
  modelName,
  sharedModelNames,
} from '@/app/features/shared/models/model-name';

/** One side of an arena verdict: its model, and the provider that served
 * it (`null` on a verdict recorded before verdicts named providers). */
export interface ArenaSide {
  readonly model: string;
  readonly provider: string | null;
}

/**
 * Names the sides of the arena verdicts in one list by the shared rule
 * (`shared/models/model-name.ts`): `provider · model` where the list holds
 * the model through another provider too, the model's id otherwise. A side
 * recorded without a provider counts as a provider of its own and keeps its
 * id, so `openrouter · luna` stays apart from an old `luna`.
 */
export function arenaSideNames(
  sides: readonly ArenaSide[],
): (side: ArenaSide) => string {
  const shared = sharedModelNames(
    sides.map((side) => ({
      id: side.model,
      providerSlug: side.provider ?? '',
    })),
  );
  return (side) =>
    side.provider === null
      ? side.model
      : modelName({ id: side.model, providerSlug: side.provider }, shared);
}
