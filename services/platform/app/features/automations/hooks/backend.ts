import type { ItemOf } from '@/app/lib/backend/contract';
import { nodeTypes } from '@/lib/engine/core/slots';

/**
 * Backend bindings of the automations surface.
 *
 * The store — versions, deployments, triggers, runs — is reached through the
 * generated `api` like any other surface, so those calls live directly in
 * `queries.ts` / `mutations.ts` and cannot drift from the server.
 *
 * The node-type catalog is bound here rather than there because the editor
 * also needs the CORE types when the call has not resolved (or was refused):
 * `transform`, `llm`, and `subautomation` are registered in
 * `lib/engine/core/slots.ts` at module scope, with the same field
 * declarations the executor validates against, and `mergeNodeTypes` folds
 * the server's connector types (`<connector>.<action>`) over that floor.
 */

/**
 * Every node type the engine has registered — core types plus one per
 * connector action. An action: reading the connector catalog needs the
 * deployment's config tree.
 */
export const listNodeTypesRef = 'automations/catalog:listNodeTypes';

/** One node type as the editor needs it — the server's own return shape. */
export type NodeTypeSummary = ItemOf<typeof listNodeTypesRef>;

/** The core node types, read from the engine's own registry so the editor
 * never carries a hand-written copy of the node grammar. */
export function coreNodeTypes(): NodeTypeSummary[] {
  return [...nodeTypes().values()]
    .filter((def) => def.kind === 'core')
    .map((def) => ({
      type: def.type,
      kind: def.kind,
      description: def.description,
      allowedFields: [...def.allowedFields],
      requiredFields: [...def.requiredFields],
      outputKind: def.outputKind,
    }));
}

/**
 * The catalog the editor works against: the core types always, plus whatever
 * the deployment reports. A type the catalog also declares wins, so a host that
 * refines a core type is respected rather than shadowed.
 */
export function mergeNodeTypes(
  fromCatalog: readonly NodeTypeSummary[] | undefined,
): NodeTypeSummary[] {
  const merged = new Map<string, NodeTypeSummary>();
  for (const def of coreNodeTypes()) merged.set(def.type, def);
  for (const def of fromCatalog ?? []) merged.set(def.type, def);
  return [...merged.values()].sort((a, b) => a.type.localeCompare(b.type));
}
