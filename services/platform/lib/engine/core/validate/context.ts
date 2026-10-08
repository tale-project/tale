/**
 * The state one `validate()` call threads through its passes: the document,
 * where each node sits in it, and a parse memo so each expression is parsed
 * once however many passes read it.
 *
 * Created per call and dropped with it — parsed code, sources, pointers and
 * the child documents of one organization's automation never outlive the
 * request that brought them, so nothing here can leak into another
 * tenant's validation.
 */

import { isRecord } from '../../../utils/type-utils';
import type { StoreAdapter } from '../slots';
import {
  newParseCtx,
  outputSources,
  sourcesOf,
  type ExprSource,
  type ParseCtx,
} from '../syntax/sources';
import type { Issue, NodeDef } from '../types';
import type { ChildDocuments } from '../typing/children';

export interface ValidationContext {
  doc: Record<string, unknown>;
  rawNodes: unknown[];
  /** First position in `doc.nodes` of each node id (duplicates resolve to
   * the first occurrence). */
  indexById: Map<string, number>;
  parse: ParseCtx;
  store?: StoreAdapter;
  /** The documents the subautomation nodes run, resolved like a run
   * resolves them (fetched once per call; absent without a store). */
  children?: ChildDocuments;
  issues: Issue[];
  /** The node's position in `doc.nodes` — what its pointers start with. */
  indexOf(node: NodeDef): number;
  /** Every expression source of the node at `index` (memoized). */
  sources(index: number): ExprSource[];
  /** The template sources of the document `output` (memoized). */
  outputSources(): ExprSource[];
}

/** A raw node record read as a node: `sourcesOf` checks the type of every
 * field it reads, and the node pass reports the wrong-typed ones. */
function asNode(raw: Record<string, unknown>): NodeDef {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sourcesOf reads every field defensively; the node pass reports the wrong-typed ones
  return raw as unknown as NodeDef;
}

export function createValidationContext(
  doc: Record<string, unknown>,
  issues: Issue[],
  store: StoreAdapter | undefined,
): ValidationContext {
  const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const indexById = new Map<string, number>();
  const positions = new Map<unknown, number>();
  for (const [i, raw] of rawNodes.entries()) {
    if (!positions.has(raw)) positions.set(raw, i);
    if (isRecord(raw) && typeof raw.id === 'string' && !indexById.has(raw.id)) {
      indexById.set(raw.id, i);
    }
  }
  const parse = newParseCtx();
  const memo = new Map<number, ExprSource[]>();
  let output: ExprSource[] | undefined;
  return {
    doc,
    rawNodes,
    indexById,
    parse,
    ...(store !== undefined && { store }),
    issues,
    indexOf(node) {
      return positions.get(node) ?? indexById.get(node.id) ?? -1;
    },
    sources(index) {
      let got = memo.get(index);
      if (got === undefined) {
        const raw = rawNodes[index];
        got = isRecord(raw) ? sourcesOf(asNode(raw), index, parse) : [];
        memo.set(index, got);
      }
      return got;
    },
    outputSources() {
      output ??= outputSources(doc.output, parse);
      return output;
    },
  };
}
