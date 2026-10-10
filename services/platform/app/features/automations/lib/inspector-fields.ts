/**
 * Which of a node's fields the inspector edits, and with what. One answer for
 * the inspector, which renders the fields, and for the Problems panel, which
 * needs to know whether a problem has a field to go to or only its node.
 *
 * Every field that holds code, a template or JSON is edited in the code
 * editor, in the language the engine reads it as; the few fields with a
 * fixed set of values get a control that offers exactly those.
 */

import type { SourceField } from '@/lib/engine/core/syntax/globals';
import type { NodeDef } from '@/lib/engine/core/types';

/** The control-flow fields every node type accepts, in reading order. */
export const CONTROL_FLOW_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
  'maxRepeats',
  'onError',
] as const;

export type ControlFlowField = (typeof CONTROL_FLOW_FIELDS)[number];

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

/** How one field is edited. */
export type FieldEditor =
  | {
      kind: 'code';
      language: 'javascript' | 'markdown' | 'expression' | 'template';
      /** The expression scope the engine gives the field. */
      source: SourceField;
      templates: boolean;
      font: 'mono' | 'prose';
      singleLine: boolean;
      minRows: number;
      maxRows: number;
      lineNumbers: boolean;
      expandable: boolean;
    }
  | {
      kind: 'json';
      expect: 'object' | 'array';
      /** Templates in its strings, read in this scope; none for a schema. */
      source: SourceField | null;
      minRows: number;
      maxRows: number;
    }
  /** A value this build has no control for, shown as JSON. */
  | { kind: 'readonlyJson' }
  | { kind: 'text' }
  /** The llm node's picker of served models. */
  | { kind: 'model' }
  | { kind: 'maxRepeats' }
  | { kind: 'elseOf' }
  | { kind: 'onError' };

const CODE_DEFAULTS = {
  kind: 'code',
  templates: false,
  font: 'mono',
  singleLine: false,
  minRows: 3,
  maxRows: 14,
  lineNumbers: false,
  expandable: false,
} as const;

/** A condition is one bare expression until it holds `{{`; then it is a
 *  template, read as the engine reads it (`conditionKind`). */
function conditionEditor(
  source: 'when' | 'repeatUntil' | 'forEach',
  value: unknown,
): FieldEditor {
  const template =
    source === 'forEach' || (typeof value === 'string' && value.includes('{{'));
  return {
    ...CODE_DEFAULTS,
    language: template ? 'template' : 'expression',
    source,
    templates: template,
    singleLine: true,
    minRows: 1,
    maxRows: 4,
  };
}

/** The control for `field` of `node`, whose value is `value`. */
export function fieldEditor(
  node: NodeDef,
  field: string,
  value: unknown,
): FieldEditor {
  switch (field) {
    case 'code':
      return {
        ...CODE_DEFAULTS,
        language: 'javascript',
        source: 'code',
        minRows: 6,
        maxRows: 20,
        lineNumbers: true,
        expandable: true,
      };
    case 'prompt':
    case 'system':
      return {
        ...CODE_DEFAULTS,
        language: 'markdown',
        source: field,
        templates: true,
        font: 'prose',
        maxRows: 12,
        expandable: true,
      };
    case 'input':
    case 'files':
      return {
        kind: 'json',
        expect: 'object',
        source: field,
        minRows: 3,
        maxRows: 14,
      };
    case 'outputSchema':
      return {
        kind: 'json',
        expect: 'object',
        source: null,
        minRows: 3,
        maxRows: 14,
      };
    case 'when':
    case 'repeatUntil':
    case 'forEach':
      return conditionEditor(field, value);
    case 'maxRepeats':
      return { kind: 'maxRepeats' };
    case 'elseOf':
      return { kind: 'elseOf' };
    case 'onError':
      return { kind: 'onError' };
    case 'model':
      return node.type === 'llm' ? { kind: 'model' } : { kind: 'text' };
    default:
      return value === undefined || typeof value === 'string'
        ? { kind: 'text' }
        : { kind: 'readonlyJson' };
  }
}

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

/** The control-flow fields the inspector shows for `node`: Maximum
 *  repeats only beside a Repeat until, or when it holds a value. */
export function shownControlFlowFields(node: NodeDef): ControlFlowField[] {
  return CONTROL_FLOW_FIELDS.filter(
    (field) =>
      field !== 'maxRepeats' ||
      typeof node.repeatUntil === 'string' ||
      node.maxRepeats !== undefined,
  );
}

/**
 * The fields whose control shows a problem's message under it and can take
 * the reader there: the code, text and JSON fields, the input mapping and
 * the control-flow fields. A model picker or an agent's equipment shows its
 * problems in the node's own list at the top of the inspector instead.
 */
export function fieldsWithIssueControl(
  node: NodeDef,
  allowedFields: readonly string[],
): ReadonlySet<string> {
  const fields = new Set<string>(['input', ...shownControlFlowFields(node)]);
  for (const field of declaredInspectorFields(node, allowedFields)) {
    // The llm node's Model is a picker of served models, not a text box.
    if (node.type === 'llm' && field === 'model') continue;
    fields.add(field);
  }
  return fields;
}
