/**
 * Reading a stored automation document on the client.
 *
 * The store keeps a version's document as `v.any()` — the engine owns the v1
 * grammar and Convex would have to mirror the whole node grammar to type it —
 * so every surface that renders one reads it through this narrowed view. The
 * narrowing is deliberately forgiving: a document authored by an agent may
 * be incomplete, and a canvas that refuses to draw an imperfect document is
 * useless exactly when it is needed most. A known field whose value has the
 * wrong kind is left out of the view, never guessed; every other key stays
 * on it as written.
 *
 * This is a reading view only. The editor's draft is the raw document
 * (`./draft-document`): an edit patches the raw object, and a save sends it,
 * so nothing this view leaves out is lost.
 *
 * `ui` is the engine's declared free metadata. The canvas lays every
 * automation out from its references and never reads it; it is carried
 * through a save as it was.
 */

import type { NodeDef, Automation } from '@/lib/engine/core/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A node's string-list equipment (skills, connectors, tools, secrets). Kept
 * when present — even empty — so the field round-trips; non-string members are
 * dropped, never guessed. */
function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

/** The node fields that hold a string. */
const STRING_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
  'code',
  'prompt',
  'system',
  'model',
  // The provider pin saved with the model pick. Dropping it made every
  // stored pick render as unpinned — the editor showed whatever provider the
  // serving walk would choose.
  'modelProvider',
  'automation',
  // Agent equipment: the harness that runs the turn.
  'harness',
] as const;

/** The node fields that hold a JSON object. */
const OBJECT_FIELDS = ['input', 'outputSchema', 'files'] as const;

/** An agent node's string-list equipment. */
const LIST_FIELDS = ['skills', 'connectors', 'tools', 'secrets'] as const;

/** The keys the view narrows to their kinds; a value of the wrong kind is
 *  left out. */
const NARROWED_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  ...STRING_FIELDS,
  ...OBJECT_FIELDS,
  ...LIST_FIELDS,
  'maxRepeats',
  'onError',
]);

/**
 * Narrow one raw node. A node without a usable `id` cannot be referenced,
 * selected or pointed at, so it is left out of the view (the check reports
 * it). A node without a `type` stays, with an empty type: it is not drawn,
 * but its place in the list keeps every later node at the index the check's
 * pointers name.
 */
function readNode(value: unknown): NodeDef | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  const node: NodeDef = { id, type: readString(value.type) ?? '' };
  // Every key this view does not narrow stays as written — a connector's
  // `credential`, a key a newer engine knows.
  for (const [key, raw] of Object.entries(value)) {
    if (!NARROWED_FIELDS.has(key)) Object.assign(node, { [key]: raw });
  }
  for (const field of STRING_FIELDS) {
    const raw = value[field];
    if (typeof raw === 'string') node[field] = raw;
  }
  for (const field of OBJECT_FIELDS) {
    const raw = value[field];
    if (isRecord(raw)) node[field] = raw;
  }
  for (const field of LIST_FIELDS) {
    const list = readStringArray(value[field]);
    if (list !== undefined) node[field] = list;
  }
  if (typeof value.maxRepeats === 'number') node.maxRepeats = value.maxRepeats;
  if (value.onError === 'fail' || value.onError === 'continue') {
    node.onError = value.onError;
  }
  return node;
}

/**
 * Narrow a stored document into the engine's `Automation` shape. Returns `null`
 * only when the value is not an object at all — a document missing its nodes
 * still renders (as an empty canvas), which is what an author who has just
 * created one expects to see.
 */
export function readDocument(value: unknown): Automation | null {
  if (!isRecord(value)) return null;
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes: NodeDef[] = [];
  for (const raw of rawNodes) {
    const node = readNode(raw);
    if (node) nodes.push(node);
  }
  const automation: Automation = { name: readString(value.name) ?? '', nodes };
  if (typeof value.version === 'number') automation.version = value.version;
  const description = readString(value.description);
  if (description !== undefined) automation.description = description;
  if (isRecord(value.inputs)) automation.inputs = value.inputs;
  if (value.output !== undefined) automation.output = value.output;
  if (isRecord(value.ui)) automation.ui = value.ui;
  if (Array.isArray(value.tests)) {
    automation.tests = value.tests.flatMap((test) =>
      isRecord(test) && typeof test.name === 'string'
        ? [{ name: test.name, input: null, ...test }]
        : [],
    );
  }
  return automation;
}
