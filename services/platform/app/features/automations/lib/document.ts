/**
 * Reading a stored automation document on the client.
 *
 * The store keeps a version's document as `v.any()` — the engine owns the v1
 * grammar and Convex would have to mirror the whole node grammar to type it —
 * so every surface that renders one starts by narrowing the raw value here.
 * The narrowing is deliberately forgiving: a document authored by an agent, or
 * carried over by a conversion, may be incomplete, and a canvas that refuses to
 * draw an imperfect document is useless exactly when it is needed most. What
 * cannot be understood is dropped, never guessed.
 *
 * `ui` is the engine's declared canvas metadata — "ignored by the engine" — and
 * is where this feature keeps the two things the canvas needs and the executor
 * must not see: hand-placed node positions and the converter's review notes.
 */

import type { NodeDef, Workflow } from '@/lib/engine/core/types';

/** Where a node sits on the canvas when an author placed it by hand. */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * One construct a conversion could not re-express faithfully, as
 * `lib/automations/convert.ts` reports it: the node it concerns and why a
 * human has to look.
 */
export interface ReviewNote {
  node: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
    'workflow',
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
  return node;
}

/**
 * Narrow a stored document into the engine's `Workflow` shape. Returns `null`
 * only when the value is not an object at all — a document missing its nodes
 * still renders (as an empty canvas), which is what an author who has just
 * created one expects to see.
 */
export function readDocument(value: unknown): Workflow | null {
  if (!isRecord(value)) return null;
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes: NodeDef[] = [];
  for (const raw of rawNodes) {
    const node = readNode(raw);
    if (node) nodes.push(node);
  }
  const workflow: Workflow = { name: readString(value.name) ?? '', nodes };
  if (typeof value.version === 'number') workflow.version = value.version;
  const description = readString(value.description);
  if (description !== undefined) workflow.description = description;
  if (isRecord(value.inputs)) workflow.inputs = value.inputs;
  if (value.output !== undefined) workflow.output = value.output;
  if (isRecord(value.ui)) workflow.ui = value.ui;
  if (Array.isArray(value.tests)) {
    workflow.tests = value.tests.flatMap((test) =>
      isRecord(test) && typeof test.name === 'string'
        ? [{ name: test.name, input: null, ...test }]
        : [],
    );
  }
  return workflow;
}

/** Hand-placed node positions, from `ui.positions`. Nodes without an entry are
 * laid out automatically. */
export function readPositions(
  workflow: Workflow | null,
): Record<string, NodePosition> {
  const raw = workflow?.ui?.positions;
  if (!isRecord(raw)) return {};
  const out: Record<string, NodePosition> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { x, y } = value;
    if (typeof x === 'number' && typeof y === 'number') out[id] = { x, y };
  }
  return out;
}

/**
 * The converter's review notes, from `ui.needsReview`.
 *
 * SEAM — this is the one place the feature assumes where a conversion records
 * what it could not re-express. `lib/automations/convert.ts` returns
 * `{workflow, needsReview}`, but nothing writes the result yet; the notes ride
 * in the document's canvas metadata because they annotate NODES for a human and
 * must never reach the executor. When the writer lands it fills
 * `ui.needsReview` with the same `{node, reason}` records and nothing here
 * changes. Until then a document simply carries none, and the canvas correctly
 * reports that no node is flagged — rather than inventing flags.
 */
export function readReviewNotes(workflow: Workflow | null): ReviewNote[] {
  const raw = workflow?.ui?.needsReview;
  if (!Array.isArray(raw)) return [];
  const out: ReviewNote[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    const node = readString(value.node);
    const reason = readString(value.reason);
    if (node && reason) out.push({ node, reason });
  }
  return out;
}

/** Review notes grouped by the node they concern, for per-node display. */
export function reviewNotesByNode(
  notes: readonly ReviewNote[],
): Map<string, ReviewNote[]> {
  const grouped = new Map<string, ReviewNote[]>();
  for (const note of notes) {
    const bucket = grouped.get(note.node);
    if (bucket) bucket.push(note);
    else grouped.set(note.node, [note]);
  }
  return grouped;
}
