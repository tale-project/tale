/**
 * Runtime scope assembly and deterministic mock backends.
 *
 * Scopes are data-only snapshots: values are cloned through JSON, which is
 * exactly the shape that can cross the CodeRunner boundary — agent code can
 * never mutate engine state or receive a host reference. Secrets never enter
 * a scope; they are handed by the host to live() calls only.
 */

export interface RunScope extends Record<string, unknown> {
  input: unknown;
  nodes: Record<string, { output: unknown }>;
}

/** JSON round-trip clone — the engine's data-only law made concrete.
 * `undefined` stays `undefined` (JSON has no encoding for it). */
export function cloneData<T>(value: T): T {
  if (value === undefined) return value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON round-trip preserves the input's own JSON shape
  return JSON.parse(JSON.stringify(value)) as T;
}

export function makeScope(
  input: unknown,
  nodeOutputs: Record<string, { output: unknown }>,
  extra: Record<string, unknown> = {},
): RunScope {
  return {
    input: cloneData(input),
    nodes: cloneData(nodeOutputs),
    ...cloneData(extra),
  };
}

export function newRunId(): string {
  return `run_${Math.random().toString(36).slice(2, 10)}`;
}

/** FNV-1a tag of a prompt — the stable hash both mock texts embed. */
function promptTag(prompt: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 100000).toString(36);
}

/** Deterministic default text for llm nodes in mock mode: a stable hash tag
 * plus the prompt head, so acceptance tests can compute expected values and
 * two runs of one document are byte-identical. */
export function mockLlmText(model: string, prompt: string): string {
  const head = prompt.replace(/\s+/g, ' ').trim().slice(0, 70);
  return `MOCK_LLM_RESPONSE[${model}:${promptTag(prompt)}]: ${head}`;
}

/** Deterministic default reply for agent nodes in mock mode — same contract
 * as {@link mockLlmText}, distinct marker so traces read honestly. */
export function mockAgentText(model: string, prompt: string): string {
  const head = prompt.replace(/\s+/g, ' ').trim().slice(0, 70);
  return `MOCK_AGENT_RESPONSE[${model}:${promptTag(prompt)}]: ${head}`;
}

/**
 * A deterministic minimal object satisfying a JSON Schema — the mock output
 * of an llm node with `outputSchema`. Only the structural keywords matter
 * here (type/properties/required/items/enum); the goal is a stable,
 * recognizable stub, not full schema coverage.
 */
export function stubFromSchema(schema: Record<string, unknown>): unknown {
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  switch (type) {
    case 'string':
      return 'mock';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const items = schema.items;
      return items && typeof items === 'object' && !Array.isArray(items)
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
          [stubFromSchema(items as Record<string, unknown>)]
        : [];
    }
    default: {
      // Objects (and untyped schemas): fill every required property from its
      // declared shape; optional properties stay absent for minimality.
      const properties =
        schema.properties &&
        typeof schema.properties === 'object' &&
        !Array.isArray(schema.properties)
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
            (schema.properties as Record<string, unknown>)
          : {};
      const required = Array.isArray(schema.required)
        ? schema.required.filter((k): k is string => typeof k === 'string')
        : [];
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const prop = properties[key];
        out[key] =
          prop && typeof prop === 'object' && !Array.isArray(prop)
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
              stubFromSchema(prop as Record<string, unknown>)
            : 'mock';
      }
      return out;
    }
  }
}
