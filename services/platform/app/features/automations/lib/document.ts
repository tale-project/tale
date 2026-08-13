/**
 * Reading a stored automation document on the client.
 *
 * The store keeps a version's document as `v.any()` — the engine owns the v1
 * grammar and Convex would have to mirror the whole node grammar to type it —
 * so every surface that renders one starts by narrowing the raw value here.
 * The narrowing is deliberately forgiving: a document authored by an agent may
 * be incomplete, and a canvas that refuses to draw an imperfect document is
 * useless exactly when it is needed most. What cannot be understood is
 * dropped, never guessed.
 *
 * `ui` is the engine's declared canvas metadata — "ignored by the engine" — and
 * is where this feature keeps what the canvas needs and the executor must not
 * see: hand-placed node positions.
 */

import type { NodeDef, Automation } from '@/lib/engine/core/types';

/** Where a node sits on the canvas when an author placed it by hand. */
export interface NodePosition {
  x: number;
  y: number;
}

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

/** Narrow one raw node. A node without a usable `id` and `type` cannot be
 * drawn or referenced, so it is dropped rather than rendered as a blank box. */
function readNode(value: unknown): NodeDef | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  const type = readString(value.type);
  if (!id || !type) return undefined;
  const node: NodeDef = { id, type };
  for (const field of [
    'when',
    'elseOf',
    'forEach',
    'repeatUntil',
    'code',
    'prompt',
    'system',
    'model',
    'automation',
    // Agent equipment: the harness that runs the turn. Dropping it here would
    // make the canvas read an agent node as unequipped and a later save would
    // persist that loss.
    'harness',
  ] as const) {
    const raw = value[field];
    if (typeof raw === 'string') node[field] = raw;
  }
  if (typeof value.maxRepeats === 'number') node.maxRepeats = value.maxRepeats;
  if (value.onError === 'fail' || value.onError === 'continue') {
    node.onError = value.onError;
  }
  if (isRecord(value.input)) node.input = value.input;
  if (isRecord(value.outputSchema)) node.outputSchema = value.outputSchema;
  // The rest of an agent node's equipment — the skills, connectors, platform
  // tools and secrets the wizard binds, and staged files. Same reason as
  // `harness`: read them through so a prompt edit + save preserves them.
  for (const field of ['skills', 'connectors', 'tools', 'secrets'] as const) {
    const list = readStringArray(value[field]);
    if (list !== undefined) node[field] = list;
  }
  if (isRecord(value.files)) node.files = value.files;
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

/** Hand-placed node positions, from `ui.positions`. Nodes without an entry are
 * laid out automatically. */
export function readPositions(
  automation: Automation | null,
): Record<string, NodePosition> {
  const raw = automation?.ui?.positions;
  if (!isRecord(raw)) return {};
  const out: Record<string, NodePosition> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { x, y } = value;
    if (typeof x === 'number' && typeof y === 'number') out[id] = { x, y };
  }
  return out;
}
