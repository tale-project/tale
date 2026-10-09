/**
 * The editor's draft is the stored document itself, raw: every key an
 * author, an agent or an older build wrote stays in it, whether or not this
 * build has a control for it. The canvas and the inspector read a narrowed
 * view of it (`readDocument` in `./document`); an edit patches the raw
 * object, and the check, a save and a deploy send the raw object back.
 *
 * Narrowing the draft itself once dropped a connector node's `credential`,
 * any key the reading view did not know and every node it could not draw,
 * and gave each test an `input: null` it never had — all of it persisted by
 * the next save of an unrelated prompt edit.
 */

/** A document as stored: a JSON object, nothing about it assumed. */
export type RawDocument = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The stored value as a raw document; `null` when it is not an object. */
export function rawDocumentOf(value: unknown): RawDocument | null {
  return isRecord(value) ? value : null;
}

/**
 * Set every key of `patch` on `target`; a key patched to `undefined` is
 * removed, so a cleared field leaves the document instead of sitting in it
 * as an empty value the engine would read.
 */
function applyPatch(
  target: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * Patch the node with `nodeId` — its first occurrence, the one both
 * executors run — and leave every other node, and every other key of this
 * one, exactly as it was. Answers the same document when no node has the id.
 */
export function applyNodePatch(
  raw: RawDocument,
  nodeId: string,
  patch: Readonly<Record<string, unknown>>,
): RawDocument {
  const nodes = raw.nodes;
  if (!Array.isArray(nodes)) return raw;
  const index = nodes.findIndex(
    (node: unknown) => isRecord(node) && node.id === nodeId,
  );
  const node: unknown = nodes[index];
  if (index === -1 || !isRecord(node)) return raw;
  const nextNodes = [...nodes];
  nextNodes[index] = applyPatch(node, patch);
  return { ...raw, nodes: nextNodes };
}

/** The document's own fields Start and End edit: the run input's schema and
 *  what a successful run returns. */
export interface DocumentPatch {
  inputs?: unknown;
  output?: unknown;
}

/**
 * Patch the document's `inputs` or `output`. A field patched to `undefined`
 * is removed; a field the patch does not name is left alone.
 */
export function applyDocumentPatch(
  raw: RawDocument,
  patch: DocumentPatch,
): RawDocument {
  const named: Record<string, unknown> = {};
  if ('inputs' in patch) named.inputs = patch.inputs;
  if ('output' in patch) named.output = patch.output;
  return applyPatch(raw, named);
}
