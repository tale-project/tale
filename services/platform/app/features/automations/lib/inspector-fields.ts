/**
 * Which of a node's fields the inspector edits, and with what. One answer for
 * the inspector, which renders the fields, and for the Problems panel, which
 * needs to know whether a problem has a field to go to or only its node.
 */

import type { NodeDef } from '@/lib/engine/core/types';

/** The control-flow fields every node type accepts, in reading order. */
export const CONTROL_FLOW_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
] as const;

/** The agent node's own pickers (`AgentNodeFields`); the inspector's generic
 * field loop must not render them a second time. */
const AGENT_EQUIPMENT_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'modelProvider',
  'harness',
  'skills',
  'connectors',
  'tools',
  'secrets',
]);

/**
 * The declared fields the inspector's generic loop renders, in the node
 * type's order: everything the type allows except its input mapping (always
 * rendered last, on its own) and an agent's equipment (its own pickers).
 */
export function declaredInspectorFields(
  node: NodeDef,
  allowedFields: readonly string[],
): string[] {
  const isAgent = node.type === 'agent';
  return allowedFields.filter(
    (field) =>
      field !== 'input' && !(isAgent && AGENT_EQUIPMENT_FIELDS.has(field)),
  );
}

/**
 * The fields whose control shows a problem's message under it and can take
 * the reader there: the text and JSON boxes, the input mapping and the
 * control-flow fields. A model picker or an agent's equipment shows its
 * problems in the node's own list at the top of the inspector instead.
 */
export function fieldsWithIssueControl(
  node: NodeDef,
  allowedFields: readonly string[],
): ReadonlySet<string> {
  const fields = new Set<string>(['input', ...CONTROL_FLOW_FIELDS]);
  for (const field of declaredInspectorFields(node, allowedFields)) {
    // The llm node's Model is a picker of served models, not a text box.
    if (node.type === 'llm' && field === 'model') continue;
    fields.add(field);
  }
  return fields;
}
