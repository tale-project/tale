/**
 * A step's `role` is resolved to a concrete agent at runtime against the
 * existing org-chart delegation graph (see convex/agents/resolve_role_to_agent).
 * It is ADVISORY — never a gate that can break execution.
 *
 * A role string is either a reserved STRUCTURAL token (interpreted relative to a
 * context agent's position in the graph) or, in the open case, an agent slug.
 * No new "role" entity is introduced — roles are synthesized from the graph.
 */
export const STRUCTURAL_ROLES = [
  'manager', // the context agent's manager (primary parent)
  'report', // a direct report of the context agent
  'self', // the context agent itself
] as const;

type StructuralRole = (typeof STRUCTURAL_ROLES)[number];

const STRUCTURAL_ROLE_SET = new Set<string>(STRUCTURAL_ROLES);

export function isStructuralRole(value: string): value is StructuralRole {
  return STRUCTURAL_ROLE_SET.has(value);
}
