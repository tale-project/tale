/**
 * Extract essential loop variables to avoid persisting huge arrays
 * Keep state, item, index, items, and parent for continuation and nested loops
 */

import { isRecord } from '../../../../lib/utils/type-guards';

export function extractEssentialLoopVariables(
  resultVariables?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const loopAny = isRecord(resultVariables?.loop)
    ? resultVariables.loop
    : undefined;

  if (!loopAny) {
    return undefined;
  }

  const state = isRecord(loopAny.state) ? loopAny.state : undefined;
  const item = loopAny.item;
  const index = loopAny.index;
  const items = loopAny.items;
  const parent = loopAny.parent;
  const ownerStepSlug =
    typeof loopAny.ownerStepSlug === 'string'
      ? loopAny.ownerStepSlug
      : undefined;
  // Backwards-compat: support older executions that used ownerStepId
  const ownerStepId =
    typeof loopAny.ownerStepId === 'string' ? loopAny.ownerStepId : undefined;

  const resolvedOwnerStepSlug = ownerStepSlug ?? ownerStepId;

  // If a nested (child) loop has completed, restore the parent loop context so the
  // engine can continue or finish the outer loop instead of restarting a new one.
  if (state?.isComplete === true && isRecord(parent)) {
    const pOwnerStepSlug =
      typeof parent.ownerStepSlug === 'string'
        ? parent.ownerStepSlug
        : undefined;
    const pOwnerStepId =
      typeof parent.ownerStepId === 'string' ? parent.ownerStepId : undefined;
    const parentOwnerStepSlug = pOwnerStepSlug ?? pOwnerStepId;

    return {
      state: parent.state,
      item: parent.item,
      index: parent.index,
      items: parent.items,
      parent: parent.parent,
      ownerStepSlug: parentOwnerStepSlug,
    };
  }

  // Keep the minimal loop fields (including parent and ownerStepSlug) so we can continue properly
  return {
    state,
    item,
    index,
    items,
    parent,
    ownerStepSlug: resolvedOwnerStepSlug,
  };
}
