import { makeFunctionReference } from 'convex/server';

import { nodeTypes } from '@/lib/engine/core/slots';

/**
 * Backend bindings of the automations surface.
 *
 * The store — versions, deployments, triggers, runs — is reached through the
 * generated `api` like any other surface, so those calls live directly in
 * `queries.ts` / `mutations.ts` and cannot drift from the server.
 *
 * THE ONE SEAM is the node-type catalog. The engine's registry is the authority
 * on what a node may be and which fields each type takes, but it is assembled
 * server-side: connectors are registered from
 * `configs/platform/system/integrations/<slug>/connector.yml`, which needs the
 * filesystem, and the deployment exposes no public listing for it yet. So the
 * catalog call is bound BY NAME — the same escape hatch the integrations
 * settings page uses — with the shape it is expected to return declared below.
 *
 * WIRING: when the listing action lands, replace `listNodeTypesRef` with its
 * `api.…` reference and derive `NodeTypeSummary` from it with
 * `FunctionReturnType`. Nothing else in the feature changes.
 *
 * Until then the editor still knows the CORE node types, because it reads them
 * from the engine's own table rather than from a list written out by hand here
 * — `transform`, `llm`, and `subworkflow` are registered in
 * `lib/engine/core/slots.ts` at module scope, with the same field declarations
 * the executor validates against. Connector types (`<connector>.<action>`) join
 * that set the moment the catalog call resolves.
 */

/** One node type as the editor needs it: what it is, and which fields it
 * takes beyond the id, the type, and the control-flow fields every node
 * shares. */
export interface NodeTypeSummary {
  /** `transform`, `llm`, `subworkflow`, or `<connector>.<action>`. */
  type: string;
  kind: 'core' | 'integration';
  description: string;
  /** Fields the type accepts, in the registry's own order. */
  allowedFields: string[];
  /** The subset of `allowedFields` a valid node must set. */
  requiredFields: string[];
  /** Whether the output is a shape callers may path into, or free text. */
  outputKind: 'structured' | 'unstructured';
  /** Integration types only: whether invoking it changes the outside world,
   * which is what makes a run record an effect for it. */
  hasEffect?: boolean;
}

/**
 * Every node type the engine has registered — core types plus one per
 * connector action. An action: reading the connector catalog needs the
 * deployment's config tree.
 */
export const listNodeTypesRef = makeFunctionReference<
  'action',
  { organizationId: string },
  NodeTypeSummary[]
>('automations/catalog:listNodeTypes');

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
