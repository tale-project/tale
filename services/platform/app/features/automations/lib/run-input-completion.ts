/**
 * Completion in a run's input: the fields the version's input schema
 * declares, offered where a key of the input object is typed. Apart from
 * the editor's code assistance (`./code-providers`), so the run dialog
 * never loads the canvas's modules.
 */

import type {
  CodeCompletionItem,
  CodeEditorProviders,
  CodeValueType,
} from '@tale/ui/code-editor/providers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The kind a JSON Schema field declares, for the icon beside its name. */
function schemaValueType(field: Record<string, unknown>): CodeValueType {
  const type = field.type;
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'object':
    case 'array':
    case 'null':
      return type;
    default:
      return 'unknown';
  }
}

/**
 * Completion in a run's input, a JSON object: at its top level, the fields
 * the version's input schema declares, each with its kind (`kindOf`, in the
 * reader's words) and its description; one the schema does not require is
 * marked optional.
 */
export function runInputProviders(
  schema: unknown,
  kindOf: (field: Record<string, unknown>) => string,
): CodeEditorProviders {
  const properties =
    isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    isRecord(schema) && Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === 'string')
      : [],
  );
  const items = Object.entries(properties).map(
    ([name, value]): CodeCompletionItem => {
      const field = isRecord(value) ? value : {};
      const item: CodeCompletionItem = {
        label: name,
        kind: 'input',
        valueType: schemaValueType(field),
        detail: kindOf(field),
        optional: !required.has(name),
      };
      if (typeof field.description === 'string') {
        item.info = { description: field.description };
      }
      return item;
    },
  );
  return {
    completion: (context) =>
      context.region === 'key' &&
      (context.pointer ?? '') === '' &&
      items.length > 0
        ? { items }
        : null,
  };
}
