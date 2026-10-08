/**
 * What the analysis rules read, built once per analysis call: the
 * document's parsed sources, the shape of every value (`../typing`) and the
 * flow facts (`./flow`) — plus the small helpers every rule words its
 * findings with.
 *
 * Nothing here outlives the call: the context is assembled from the
 * caller's per-call validation state and dropped with it.
 */

import { isRecord } from '../../../utils/type-utils';
import { refsOf, type NodeRefs } from '../execute/controlflow';
import { ptr } from '../syntax/pointer';
import type { ExprSource, ParseCtx, SourceField } from '../syntax/sources';
import { exprSegments, isSingleTemplate } from '../syntax/tokens';
import type { Issue, NodeDef } from '../types';
import type { ChildDocuments } from '../typing/children';
import type { TypeEnv } from '../typing/expr';
import { envFor, type AutomationTypes } from '../typing/infer';
import type { FlowFacts } from './flow';

/** The validation state the analysis starts from. */
export interface AnalysisInput {
  doc: Record<string, unknown>;
  /** The nodes the node pass accepted, first occurrence of each id, in
   * document order. */
  nodes: readonly NodeDef[];
  /** A node's position in `doc.nodes` — what its pointers start with. */
  indexOf(node: NodeDef): number;
  sources(index: number): ExprSource[];
  outputSources(): ExprSource[];
  parse: ParseCtx;
  children?: ChildDocuments;
  /** What the earlier passes found — a rule stays silent where one of them
   * already describes the same read. */
  issues: readonly Issue[];
}

/** One expression source and the node it belongs to (none for the
 * document output). */
export interface Located {
  node?: NodeDef;
  source: ExprSource;
}

export interface RuleContext extends AnalysisInput {
  byId: ReadonlyMap<string, NodeDef>;
  types: AutomationTypes;
  /** Null when the nodes reference each other in a cycle. */
  flow: FlowFacts | null;
  /** Every expression source: each node's in document order, then the
   * output's. */
  located: readonly Located[];
  /** The typed names an expression in `field` of `node` sees. */
  env(node: NodeDef | undefined, field: SourceField): TypeEnv;
  /** `/nodes/<i>` of a node id. */
  nodePointer(id: string): string;
  /** The executors' `refsOf` of a node, computed once per call. */
  refs(node: NodeDef): NodeRefs;
  /** Whether an issue with one of `codes` already sits at this place. */
  reported(
    codes: readonly string[],
    pointer: string,
    range?: readonly [number, number],
  ): boolean;
}

export function ruleContext(
  input: AnalysisInput,
  types: AutomationTypes,
  flow: FlowFacts | null,
): RuleContext {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const located: Located[] = [
    ...input.nodes.flatMap((node) =>
      input.sources(input.indexOf(node)).map((source) => ({ node, source })),
    ),
    ...input.outputSources().map((source) => ({ source })),
  ];
  const envs = new Map<string, TypeEnv>();
  const refsMemo = new Map<NodeDef, NodeRefs>();
  return {
    ...input,
    byId,
    types,
    flow,
    located,
    env(node, field) {
      const key = `${node?.id ?? ''}\u0000${field}`;
      let env = envs.get(key);
      if (env === undefined) {
        env = envFor(types, node, field);
        envs.set(key, env);
      }
      return env;
    },
    refs(node) {
      let got = refsMemo.get(node);
      if (got === undefined) {
        got = refsOf(node);
        refsMemo.set(node, got);
      }
      return got;
    },
    nodePointer(id) {
      const node = byId.get(id);
      return node === undefined ? '/nodes' : ptr('nodes', input.indexOf(node));
    },
    reported(codes, pointer, range) {
      return input.issues.some(
        (i) =>
          codes.includes(i.code) &&
          i.at?.pointer === pointer &&
          (range === undefined ||
            (i.at.range?.[0] === range[0] && i.at.range[1] === range[1])),
      );
    },
  };
}

/** Who a finding is about, as the messages name it: `node "x" prompt`, or
 * `output` for the document output. */
export function place(source: ExprSource): string {
  return source.nodeId === undefined
    ? 'output'
    : `node "${source.nodeId}" ${source.field}`;
}

/** The `node` param of a finding in a source — absent for the output. */
export function nodeParam(source: ExprSource): { node?: string } {
  return source.nodeId === undefined ? {} : { node: source.nodeId };
}

/** Whether a template source puts its expressions inside text — where a
 * missing value fails the node instead of passing through. */
export function isMixedText(source: ExprSource): boolean {
  const tokens = source.tokens;
  if (tokens === undefined || exprSegments(tokens).length === 0) return false;
  return !isSingleTemplate(source.text, tokens);
}

/** A raw `tests` entry with a name, as the test pass accepted it. */
export function testsOf(
  doc: Record<string, unknown>,
): Array<{ index: number; name: string; test: Record<string, unknown> }> {
  if (!Array.isArray(doc.tests)) return [];
  const out: Array<{
    index: number;
    name: string;
    test: Record<string, unknown>;
  }> = [];
  for (const [index, test] of doc.tests.entries()) {
    if (!isRecord(test) || typeof test.name !== 'string' || !('input' in test))
      continue;
    out.push({ index, name: test.name, test });
  }
  return out;
}
