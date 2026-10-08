/**
 * Names an expression reads that do not exist where it runs.
 *
 *  - EXPR_UNKNOWN_NAME — a name that is neither one of the field's scope
 *    names (`scopeNamesFor`) nor a JavaScript global: a ReferenceError when
 *    the expression runs. Transform code may create a global by assigning
 *    to an undeclared name (the body runs in sloppy mode), so a name the
 *    code assigns is not unknown there.
 *  - ITEM_OUT_OF_SCOPE — `item`/`index` in `when` or in `forEach` itself:
 *    both are evaluated once, before any item is, so neither name exists
 *    there and the node fails. Elsewhere on a node without forEach the
 *    reference pass reports ITEM_WITHOUT_FOREACH.
 */

import type { Node } from 'estree';
import { walk } from 'zimmerframe';

import { err, warn } from '../../errors';
import { IO_NAMES } from '../../syntax/body';
import { scopeNamesFor } from '../../syntax/globals';
import type { RefSite } from '../../syntax/walk';
import type { Issue } from '../../types';
import { closestName } from '../../validate/similar';
import { nodeParam, place, type RuleContext } from '../context';

/** Names every V8 context has besides the ES global object listed in
 * `ES_GLOBALS`; `arguments` exists because a transform body runs inside a
 * function. */
const ALSO_DEFINED: ReadonlySet<string> = new Set([
  'eval',
  'escape',
  'unescape',
  'Iterator',
  'WebAssembly',
]);

const ITERATION_NAMES: ReadonlySet<string> = new Set(['item', 'index']);

/** The names a body assigns without declaring them. */
function assignedNames(ast: Node): Set<string> {
  const out = new Set<string>();
  walk<Node, null>(ast, null, {
    _(node, { next }) {
      if (
        node.type === 'AssignmentExpression' &&
        node.left.type === 'Identifier'
      ) {
        out.add(node.left.name);
      } else if (
        node.type === 'UpdateExpression' &&
        node.argument.type === 'Identifier'
      ) {
        out.add(node.argument.name);
      } else if (
        (node.type === 'ForInStatement' || node.type === 'ForOfStatement') &&
        node.left.type === 'Identifier'
      ) {
        out.add(node.left.name);
      }
      next();
    },
  });
  return out;
}

function isFree(site: RefSite): boolean {
  return site.root === 'free' && !site.guards.includes('typeof');
}

export function nameRules(cx: RuleContext, out: Issue[]): void {
  for (const { node, source } of cx.located) {
    const available = [...scopeNamesFor(source.field, node)];
    const seen = new Set<string>();
    for (const unit of source.units) {
      if (!unit.parse.ok || unit.opaque === true) continue;
      const assigned =
        source.field === 'code'
          ? assignedNames(unit.parse.ast)
          : new Set<string>();
      for (const site of unit.refs) {
        if (!isFree(site) || seen.has(site.name)) continue;
        const { name } = site;
        if (ALSO_DEFINED.has(name)) continue;
        if (source.field === 'code') {
          if (name === 'arguments' || assigned.has(name)) continue;
          if (IO_NAMES.has(name)) continue;
        }
        if (node !== undefined && ITERATION_NAMES.has(name)) {
          // The iteration rules own these on a node.
          if (source.field !== 'when' && source.field !== 'forEach') continue;
          seen.add(name);
          out.push(itemOutOfScope(source.field, node, name, source, site));
          continue;
        }
        seen.add(name);
        const suggestion = closestName(name, available);
        const hint =
          suggestion !== undefined
            ? `did you mean "${suggestion}"?`
            : name === 'output'
              ? 'output exists only in repeatUntil; read nodes.<id>.output instead'
              : `only ${available.join(', ')} and the JavaScript globals exist here`;
        out.push(
          warn(
            'EXPR_UNKNOWN_NAME',
            `${place(source)}: "${name}" is not defined here — ${source.field} expressions see ${available.join(', ')}`,
            {
              nodeId: source.nodeId,
              hint,
              at: { pointer: source.pointer, range: site.range },
              params: {
                ...nodeParam(source),
                field: source.field,
                name,
                available,
                ...(suggestion !== undefined && { suggestion }),
              },
            },
          ),
        );
      }
    }
  }
}

function itemOutOfScope(
  field: 'when' | 'forEach',
  node: { id: string; forEach?: unknown },
  name: string,
  source: { pointer: string },
  site: RefSite,
): Issue {
  const iterates = typeof node.forEach === 'string';
  const message = iterates
    ? `node "${node.id}" ${field}: uses \`${name}\`, but ${field} is evaluated once, before the items are iterated — \`${name}\` does not exist there and the node fails`
    : `node "${node.id}" ${field}: uses \`${name}\`, which exists only in the per-item fields of a forEach node — the node fails`;
  const hint =
    field === 'forEach'
      ? 'forEach names the list itself — read it from input or nodes'
      : iterates
        ? `to skip some items, filter the list in forEach: "{{ nodes.<id>.output.items.filter(i => i.ok) }}"`
        : 'read the value from input or nodes instead';
  return err('ITEM_OUT_OF_SCOPE', message, {
    nodeId: node.id,
    hint,
    at: { pointer: source.pointer, range: site.range },
    params: { node: node.id, field, name },
  });
}
