/**
 * Extract essential loop variables to avoid persisting huge arrays
 * Keep state, item, index, items, and parent for continuation and nested loops
 */

export function extractEssentialLoopVariables(
  resultVariables?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const loopAny = resultVariables?.loop as Record<string, unknown> | undefined;

  if (!loopAny || typeof loopAny !== 'object') {
    return undefined;
  }

  const { state, item, index, items, parent, ownerStepSlug, ownerStepId } =
    loopAny as {
      state?: { isComplete?: boolean; [key: string]: unknown };
      item?: unknown;
      index?: unknown;
      items?: unknown[];
      parent?: unknown;
      ownerStepSlug?: string;
      // Backwards-compat: support older executions that used ownerStepId
      ownerStepId?: string;
    };

  const resolvedOwnerStepSlug = ownerStepSlug ?? ownerStepId;

  // If a nested (child) loop has completed, restore the parent loop context so the
  // engine can continue or finish the outer loop instead of restarting a new one.
  if (state?.isComplete === true && parent && typeof parent === 'object') {
    const p = parent as Record<string, unknown>;
    const {
      state: pState,
      item: pItem,
      index: pIndex,
      items: pItems,
      parent: pParent,
      ownerStepSlug: pOwnerStepSlug,
      ownerStepId: pOwnerStepId,
    } = p as {
      state?: unknown;
      item?: unknown;
      index?: unknown;
      items?: unknown[];
      parent?: unknown;
      ownerStepSlug?: string;
      ownerStepId?: string;
    };

    const parentOwnerStepSlug = (pOwnerStepSlug ?? pOwnerStepId) as
      | string
      | undefined;

    return {
      state: pState,
      item: pItem,
      index: pIndex,
      items: pItems,
      parent: pParent,
      ownerStepSlug: parentOwnerStepSlug,
    } as Record<string, unknown>;
  }

  // Keep the minimal loop fields (including parent and ownerStepSlug) so we can continue properly
  return {
    state,
    item,
    index,
    items,
    parent,
    ownerStepSlug: resolvedOwnerStepSlug,
  } as Record<string, unknown>;
}
