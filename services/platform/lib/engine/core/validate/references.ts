/**
 * Reference and template validation: every template expression parses, every
 * `nodes.<id>` resolves, results are read via `.output`, `item`/`index`
 * exist only under forEach, `input.<key>` matches the declared inputs
 * schema, every `{{` is closed, and the derived graph is acyclic.
 *
 * Every rule reads the parsed sources (`../syntax/sources`), so a name in a
 * comment, a string or a local binding is never a reference, and every
 * finding carries the pointer of the string and the range of the code in it.
 *
 * The `.output` and bare-reference rules target the two most common
 * reference mistakes agents make. Cycle truth is the executor's own
 * `topoSort`, so validation refuses exactly the documents the executor
 * refuses; a local DFS then names the cycle path for the message.
 */

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { refsOf, topoSort } from '../execute/controlflow';
import { pointerTokens, ptr } from '../syntax/pointer';
import type { ExprSource, ExprUnit } from '../syntax/sources';
import type { PathStep, RefSite } from '../syntax/walk';
import type { IssueParams, NodeDef } from '../types';
import type { ValidationContext } from './context';
import { closestName } from './similar';
import { analyzable, errorRange, syntaxError } from './syntax-check';

/** Fields whose templates the reference pass syntax-checks; the control
 * fields and code were checked by the node pass. */
const TEMPLATE_FIELDS: ReadonlySet<string> = new Set([
  'input',
  'prompt',
  'system',
  'files',
  'output',
]);

/** `a.b`, `a['b-c']`, `a[0]` — a member chain as an author would write it. */
function renderPath(steps: readonly PathStep[]): string {
  return steps
    .map((s) =>
      typeof s.key === 'number'
        ? `[${s.key}]`
        : /^[A-Za-z_$][\w$]*$/.test(s.key)
          ? `.${s.key}`
          : `[${JSON.stringify(s.key)}]`,
    )
    .join('');
}

/** `who` in a message: `node "x"` for a node's fields, `output` for the
 * document output. */
function who(nodeId: string | undefined): string {
  return nodeId === undefined ? 'output' : `node "${nodeId}"`;
}

/** Where a source's string sits, for the unterminated-template sentence:
 * the field, or the field and the key path below it. */
function whereIn(source: ExprSource): string {
  const base =
    source.nodeIndex === undefined ? '' : ptr('nodes', source.nodeIndex);
  const tail = source.pointer.slice(base.length + 1 + source.field.length);
  if (tail === '') return source.field;
  const keys = pointerTokens(tail);
  return (
    source.field +
    renderPath(
      keys.map((k) => ({
        key: /^\d+$/.test(k) ? Number(k) : k,
        optional: false,
        computed: false,
      })),
    )
  );
}

export async function validateReferences(
  ctx: ValidationContext,
  validNodes: NodeDef[],
  ids: Set<string>,
): Promise<void> {
  const { doc, issues } = ctx;

  /** Each `{{` without its `}}`, as a warning on the string. */
  const checkTerminated = (source: ExprSource): void => {
    for (const [start, end] of source.tokens?.unterminated ?? []) {
      issues.push(
        warn(
          'TEMPLATE_UNTERMINATED',
          `${source.nodeId === undefined ? '' : `node "${source.nodeId}" `}${whereIn(source)}: "{{" at position ${start} has no closing "}}" — it is kept as plain text`,
          {
            nodeId: source.nodeId,
            hint: 'close the template with }}, or remove the stray {{',
            at: { pointer: source.pointer, range: [start, end] },
            params: {
              ...(source.nodeId !== undefined && { node: source.nodeId }),
              field: source.field,
            },
          },
        ),
      );
    }
  };

  const checkUnit = async (
    source: ExprSource,
    unit: ExprUnit,
  ): Promise<void> => {
    const { nodeId, field, pointer } = source;
    const nodeParam: IssueParams = nodeId === undefined ? {} : { node: nodeId };
    if (TEMPLATE_FIELDS.has(field)) {
      const detail = await syntaxError(unit, 'expr');
      if (detail !== null) {
        issues.push(
          err(
            'EXPR_SYNTAX',
            `${nodeId === undefined ? '' : `node "${nodeId}" `}${field}: bad expression {{ ${unit.source} }}: ${detail}`,
            {
              nodeId,
              at: { pointer, range: errorRange(unit) },
              params: { ...nodeParam, field, expr: unit.source, detail },
            },
          ),
        );
        return;
      }
    }
    if (!analyzable(unit)) return;

    const nodeSites = unit.refs.filter(
      (r): r is RefSite & { nodeId: string } =>
        r.root === 'nodes' && r.nodeId !== undefined,
    );
    const seen = new Set<string>();
    for (const site of nodeSites) {
      const ref = site.nodeId;
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!ids.has(ref)) {
        const close = closestName(ref, ids);
        issues.push(
          err(
            'REF_UNKNOWN_NODE',
            `${nodeId === undefined ? 'output ' : `node "${nodeId}" `}references nodes.${ref} but no node with id "${ref}" exists`,
            {
              nodeId,
              hint: `${close === undefined ? '' : `did you mean "${close}"? `}known node ids: ${[...ids].join(', ')}`,
              at: { pointer, range: site.range },
              params: {
                ...nodeParam,
                field,
                ref,
                ...(close !== undefined && { suggestion: close }),
                known: [...ids],
              },
            },
          ),
        );
      }
      if (ref === nodeId && field !== 'repeatUntil') {
        issues.push(
          err('REF_SELF', `node "${nodeId}" references itself`, {
            nodeId,
            at: { pointer, range: site.range },
            params: { node: nodeId, field },
          }),
        );
      }
    }
    for (const site of nodeSites) {
      if (site.member === undefined || site.member === 'output') continue;
      issues.push(
        err(
          'REF_NOT_OUTPUT',
          `${who(nodeId)}: "nodes.${site.nodeId}${renderPath([{ key: site.member, optional: false, computed: false }])}" — node results are read via .output`,
          {
            nodeId,
            hint: `use nodes.${site.nodeId}.output.${site.member}`,
            at: { pointer, range: site.range },
            params: {
              ...nodeParam,
              field,
              source: site.nodeId,
              member: site.member,
            },
          },
        ),
      );
    }
    for (const site of nodeSites) {
      if (site.member !== undefined || site.dynamicTail === true) continue;
      issues.push(
        warn(
          'REF_BARE',
          `${who(nodeId)}: "nodes.${site.nodeId}" used without .output`,
          {
            nodeId,
            hint: `use nodes.${site.nodeId}.output`,
            at: { pointer, range: site.range },
            params: { ...nodeParam, field, source: site.nodeId },
          },
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
    const index = ctx.indexOf(n);
    const sources = ctx.sources(index);

    if (typeof n.forEach !== 'string') {
      // A free `item`/`index` outside forEach. In `when` the node has not
      // started iterating, and transform code always declares both — those
      // two would be noise here.
      const hits: Array<{ source: ExprSource; site: RefSite }> = [];
      for (const source of sources) {
        if (source.field === 'when' || source.field === 'code') continue;
        for (const unit of source.units) {
          if (!analyzable(unit)) continue;
          for (const site of unit.refs) {
            if (
              site.root === 'free' &&
              (site.name === 'item' || site.name === 'index') &&
              !site.guards.includes('typeof')
            ) {
              hits.push({ source, site });
            }
          }
        }
      }
      const iterVars = [...new Set(hits.map((h) => h.site.name))];
      const first = hits.at(0);
      if (first !== undefined) {
        const list = iterVars.map((v) => `\`${v}\``).join(' and ');
        const tail =
          iterVars.length > 1 ? 'they only exist' : `${list} only exists`;
        issues.push(
          warn(
            'ITEM_WITHOUT_FOREACH',
            `node "${n.id}" uses ${list}, but ${tail} on nodes with a "forEach" field`,
            {
              nodeId: n.id,
              hint: 'add "forEach": "{{ <array expr> }}" to this node, or reference the array element explicitly',
              at: { pointer: first.source.pointer, range: first.site.range },
              params: {
                node: n.id,
                field: first.source.field,
                names: iterVars,
              },
            },
          ),
        );
      }
    }

    for (const source of sources) {
      checkTerminated(source);
      for (const unit of source.units) {
        await checkUnit(source, unit);
        // In transform code `input` is the node's own input mapping, not the
        // automation input — only template expressions see the run input.
        if (
          declaredKeys === null ||
          source.field === 'code' ||
          !analyzable(unit)
        ) {
          continue;
        }
        const reported = new Set<string>();
        for (const site of unit.refs) {
          const key = site.path.at(0)?.key;
          if (site.root !== 'input' || typeof key !== 'string') continue;
          if (declaredKeys.has(key) || reported.has(key)) continue;
          reported.add(key);
          const close = closestName(key, declaredKeys);
          issues.push(
            warn(
              'INPUT_KEY_UNKNOWN',
              `node "${n.id}" uses input.${key}, which is not declared in the inputs schema`,
              {
                nodeId: n.id,
                hint: `${close === undefined ? '' : `did you mean "${close}"? `}declared keys: ${[...declaredKeys].join(', ') || '(none)'}`,
                at: { pointer: source.pointer, range: site.range },
                params: {
                  node: n.id,
                  field: source.field,
                  key,
                  ...(close !== undefined && { suggestion: close }),
                  declared: [...declaredKeys],
                },
              },
            ),
          );
        }
      }
    }
  }

  for (const source of ctx.outputSources()) {
    checkTerminated(source);
    for (const unit of source.units) await checkUnit(source, unit);
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
    const nodePointer = (id: string): string =>
      ptr('nodes', ctx.indexById.get(id) ?? 0);
    issues.push(
      err(
        'REF_CYCLE',
        cycle === null
          ? 'circular reference between nodes'
          : `circular reference between nodes: ${cycle.join(' → ')}`,
        {
          hint: 'automations must be acyclic — a node may not read, directly or transitively, from its own output',
          at: { pointer: cycle === null ? '/nodes' : nodePointer(cycle[0]) },
          params: { cycle: cycle ?? [] },
          ...(cycle !== null && {
            related: cycle.slice(0, -1).map((id) => ({
              role: 'cycle' as const,
              nodeId: id,
              at: { pointer: nodePointer(id) },
            })),
          }),
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
