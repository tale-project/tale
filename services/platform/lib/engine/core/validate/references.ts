/**
 * Reference and template validation: every template expression parses, every
 * `nodes.<id>` resolves, results are read via `.output`, `item`/`index`
 * exist only under forEach, `input.<key>` matches the declared inputs
 * schema, and the derived graph is acyclic.
 *
 * The `.output` and bare-reference rules target the two most common
 * reference mistakes agents make. Cycle truth is the executor's own
 * `topoSort`, so validation refuses exactly the documents the executor
 * refuses; a local DFS then names the cycle path for the message.
 */

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { refsOf, topoSort } from '../execute/controlflow';
import { codeRunner, hasCodeRunner } from '../runner';
import { inputKeysInSource, refsInSource, templateExprsIn } from '../template';
import type { Issue, NodeDef } from '../types';
import { closestName } from './similar';

export interface ExprSource {
  src: string;
  where:
    | 'input'
    | 'prompt'
    | 'system'
    | 'code'
    | 'when'
    | 'forEach'
    | 'repeatUntil'
    | 'output';
}

/** Every string source of a node that can hold references: template
 * expressions field by field, plus transform code verbatim. */
export function exprSourcesOf(n: NodeDef): ExprSource[] {
  const out: ExprSource[] = [];
  for (const e of templateExprsIn(n.input))
    out.push({ src: e, where: 'input' });
  for (const f of ['prompt', 'system'] as const) {
    const v = n[f];
    if (typeof v !== 'string') continue;
    for (const e of templateExprsIn(v)) out.push({ src: e, where: f });
  }
  if (typeof n.code === 'string') out.push({ src: n.code, where: 'code' });
  for (const f of ['when', 'forEach', 'repeatUntil'] as const) {
    const v = n[f];
    if (typeof v !== 'string') continue;
    const exprs = templateExprsIn(v);
    if (exprs.length > 0) {
      for (const e of exprs) out.push({ src: e, where: f });
    } else {
      out.push({ src: v, where: f });
    }
  }
  return out;
}

/** `nodes.x.<field>` where field is not `output`. */
const NOT_OUTPUT_RE =
  /\bnodes\s*\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*(?!output\b)([A-Za-z_$][\w$]*)/g;

/** `nodes.x` with no property access at all. */
const BARE_REF_RE = /\bnodes\s*\.\s*([A-Za-z_$][\w$]*)(?!\s*[?.[\w])/g;

/** A standalone `item`/`index` identifier (not a property like `input.index`). */
const ITER_VAR_RE = /(?<![.\w$])(item|index)\b/g;

export async function validateReferences(
  doc: Record<string, unknown>,
  validNodes: NodeDef[],
  ids: Set<string>,
  issues: Issue[],
): Promise<void> {
  const checkSource = async (
    src: string,
    nodeId: string | undefined,
    where: ExprSource['where'],
  ): Promise<void> => {
    // Control-flow fields were syntax-checked by the node pass, and code
    // rode checkBody there; template expressions parse as expressions here.
    const isTemplateExpr =
      where === 'input' ||
      where === 'prompt' ||
      where === 'system' ||
      where === 'output';
    if (isTemplateExpr && hasCodeRunner()) {
      const syntax = await codeRunner().checkExpr(src);
      if (syntax !== null) {
        issues.push(
          err(
            'EXPR_SYNTAX',
            `${nodeId === undefined ? '' : `node "${nodeId}" `}${where}: bad expression {{ ${src} }}: ${syntax}`,
            { nodeId },
          ),
        );
        return;
      }
    }
    for (const ref of refsInSource(src)) {
      if (!ids.has(ref)) {
        const close = closestName(ref, ids);
        issues.push(
          err(
            'REF_UNKNOWN_NODE',
            `${nodeId === undefined ? 'output ' : `node "${nodeId}" `}references nodes.${ref} but no node with id "${ref}" exists`,
            {
              nodeId,
              hint: `${close === undefined ? '' : `did you mean "${close}"? `}known node ids: ${[...ids].join(', ')}`,
            },
          ),
        );
      }
      if (ref === nodeId && where !== 'repeatUntil') {
        issues.push(
          err('REF_SELF', `node "${nodeId}" references itself`, { nodeId }),
        );
      }
    }
    for (const m of src.matchAll(NOT_OUTPUT_RE)) {
      issues.push(
        err(
          'REF_NOT_OUTPUT',
          `${nodeId === undefined ? 'output' : `node "${nodeId}"`}: "nodes.${m[1]}.${m[2]}" — node results are read via .output`,
          { nodeId, hint: `use nodes.${m[1]}.output.${m[2]}` },
        ),
      );
    }
    for (const m of src.matchAll(BARE_REF_RE)) {
      issues.push(
        warn(
          'REF_BARE',
          `${nodeId === undefined ? 'output' : `node "${nodeId}"`}: "nodes.${m[1]}" used without .output`,
          { nodeId, hint: `use nodes.${m[1]}.output` },
        ),
      );
    }
  };

  // input.<key> typo checks apply only when the author declared a closed
  // inputs schema with properties.
  let declaredKeys: Set<string> | null = null;
  if (
    isRecord(doc.inputs) &&
    isRecord(doc.inputs.properties) &&
    doc.inputs.additionalProperties !== true
  ) {
    declaredKeys = new Set(Object.keys(doc.inputs.properties));
  }

  for (const n of validNodes) {
    const sources = exprSourcesOf(n);

    if (typeof n.forEach !== 'string') {
      const iterVars = new Set<string>();
      for (const { src, where } of sources) {
        // In `when` the node has not started iterating, and in code `item`
        // may be a local variable — both would be noise.
        if (where === 'when' || where === 'code') continue;
        for (const m of src.matchAll(ITER_VAR_RE)) iterVars.add(m[1]);
      }
      if (iterVars.size > 0) {
        const list = [...iterVars].map((v) => `\`${v}\``).join(' and ');
        const tail =
          iterVars.size > 1 ? 'they only exist' : `${list} only exists`;
        issues.push(
          warn(
            'ITEM_WITHOUT_FOREACH',
            `node "${n.id}" uses ${list}, but ${tail} on nodes with a "forEach" field`,
            {
              nodeId: n.id,
              hint: 'add "forEach": "{{ <array expr> }}" to this node, or reference the array element explicitly',
            },
          ),
        );
      }
    }

    for (const { src, where } of sources) {
      await checkSource(src, n.id, where);
      // In transform code `input` is the node's own input mapping, not the
      // automation input — only template expressions see the run input.
      if (declaredKeys === null || where === 'code') continue;
      for (const k of inputKeysInSource(src)) {
        if (declaredKeys.has(k)) continue;
        const close = closestName(k, declaredKeys);
        issues.push(
          warn(
            'INPUT_KEY_UNKNOWN',
            `node "${n.id}" uses input.${k}, which is not declared in the inputs schema`,
            {
              nodeId: n.id,
              hint: `${close === undefined ? '' : `did you mean "${close}"? `}declared keys: ${[...declaredKeys].join(', ') || '(none)'}`,
            },
          ),
        );
      }
    }
  }

  if (doc.output !== undefined) {
    for (const e of templateExprsIn(doc.output)) {
      await checkSource(e, undefined, 'output');
    }
  }

  // Cycles. Duplicate ids also break topoSort but already carry their own
  // error, so the check runs on the first occurrence of each id.
  const unique: NodeDef[] = [];
  const seen = new Set<string>();
  for (const n of validNodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  if (unique.length > 0 && topoSort(unique) === null) {
    const cycle = findCyclePath(unique);
    issues.push(
      err(
        'REF_CYCLE',
        cycle === null
          ? 'circular reference between nodes'
          : `circular reference between nodes: ${cycle.join(' → ')}`,
        {
          hint: 'automations must be acyclic — a node may not read, directly or transitively, from its own output',
        },
      ),
    );
  }
}

/** Name one cycle over exactly the edges `topoSort` orders by. */
function findCyclePath(nodes: NodeDef[]): string[] | null {
  const ids = new Set(nodes.map((n) => n.id));
  const edges = new Map(
    nodes.map((n) => [
      n.id,
      [...refsOf(n).order].filter((r) => ids.has(r) && r !== n.id),
    ]),
  );
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const dfs = (id: string): string[] | null => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of edges.get(id) ?? []) {
      const s = state.get(dep);
      if (s === 'visiting') return [...stack.slice(stack.indexOf(dep)), dep];
      if (s === undefined) {
        const cycle = dfs(dep);
        if (cycle !== null) return cycle;
      }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const n of nodes) {
    if (!state.has(n.id)) {
      const cycle = dfs(n.id);
      if (cycle !== null) return cycle;
    }
  }
  return null;
}
