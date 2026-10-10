/**
 * Conditions that decide nothing.
 *
 *  - CONDITION_CONSTANT — a `when` that always holds (text around a template
 *    is a non-empty string, or the expression is built from literals), or a
 *    `repeatUntil` that always holds (the node runs exactly once). A `when`
 *    that never holds is UNREACHABLE's.
 *  - REPEAT_NEVER_TRUE — a `repeatUntil` that never holds: every run spends
 *    all `maxRepeats` passes.
 *  - REPEAT_UNTIL_STATIC — a `repeatUntil` that reads neither the pass's
 *    `output` nor the node's own output and asks no clock or random source:
 *    it gives the same answer after every pass.
 */

import type { Node } from 'estree';
import { walk } from 'zimmerframe';

import { warn } from '../../errors';
import { maxRepeatsOf } from '../../execute/controlflow';
import { ptr } from '../../syntax/pointer';
import type { ExprSource } from '../../syntax/sources';
import {
  conditionKind,
  exprSegments,
  tokenizeTemplate,
} from '../../syntax/tokens';
import type { Issue, NodeDef } from '../../types';
import type { RuleContext } from '../context';
import { constantCondition } from '../flow';

const REPEAT_HINT = `make the condition read this pass's result, e.g. "{{ output.status === 'done' }}"`;

/** Whether text around the templates (not only whitespace) makes the
 * condition a non-empty string. */
function hasLiteralText(text: string): boolean {
  if (conditionKind(text) !== 'mixed') return false;
  return tokenizeTemplate(text).segments.some(
    (s) => s.kind === 'text' && text.slice(s.start, s.end).trim() !== '',
  );
}

/** The first expression of a template condition, for a hint. */
function firstExpr(text: string): string {
  const segment = exprSegments(tokenizeTemplate(text)).at(0);
  return segment?.source ?? '<expr>';
}

/** Whether an expression asks something that changes between passes on its
 * own: the clock or a random number. */
function readsTime(ast: Node): boolean {
  let found = false;
  walk<Node, null>(ast, null, {
    _(node, { next }) {
      if (found) return;
      if (node.type === 'Identifier' && node.name === 'Date') found = true;
      else if (
        node.type === 'MemberExpression' &&
        node.object.type === 'Identifier' &&
        node.object.name === 'Math' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'random'
      ) {
        found = true;
      } else next();
    },
  });
  return found;
}

/** Whether a repeatUntil reads something a pass changes. */
function readsPass(n: NodeDef, source: ExprSource): boolean | undefined {
  if (source.units.length === 0) return undefined;
  for (const unit of source.units) {
    if (!unit.parse.ok || unit.opaque === true) return undefined;
    if (readsTime(unit.parse.ast)) return true;
    for (const site of unit.refs) {
      if (site.root === 'output') return true;
      if (site.root !== 'nodes') continue;
      if (site.dynamicNodeAccess === true || site.nodeId === n.id) return true;
    }
  }
  return false;
}

export function conditionRules(cx: RuleContext, out: Issue[]): void {
  for (const n of cx.nodes) {
    const index = cx.indexOf(n);
    if (typeof n.when === 'string' && constantCondition(n.when) === true) {
      const mixed = hasLiteralText(n.when);
      out.push(
        warn(
          'CONDITION_CONSTANT',
          mixed
            ? `node "${n.id}" when is always true: text around the template makes it a non-empty string`
            : `node "${n.id}" when is always true: ${n.when.trim()} never changes`,
          {
            nodeId: n.id,
            hint: mixed
              ? `write the condition as one template: "{{ ${firstExpr(n.when)} }}"`
              : 'remove the condition, or make it read data',
            at: { pointer: ptr('nodes', index, 'when') },
            params: {
              node: n.id,
              field: 'when',
              value: true,
              cause: mixed ? 'mixed-text' : 'literal',
            },
          },
        ),
      );
    }
    if (typeof n.repeatUntil !== 'string') continue;
    const pointer = ptr('nodes', index, 'repeatUntil');
    const constant = constantCondition(n.repeatUntil);
    if (constant === true) {
      const mixed = hasLiteralText(n.repeatUntil);
      out.push(
        warn(
          'CONDITION_CONSTANT',
          `node "${n.id}" repeatUntil is always true — the node runs exactly once`,
          {
            nodeId: n.id,
            hint: mixed
              ? `write the condition as one template: "{{ ${firstExpr(n.repeatUntil)} }}"`
              : "remove repeatUntil, or make it read this pass's result",
            at: { pointer },
            params: {
              node: n.id,
              field: 'repeatUntil',
              value: true,
              cause: mixed ? 'mixed-text' : 'literal',
            },
          },
        ),
      );
      continue;
    }
    if (constant === false) {
      const maxRepeats = maxRepeatsOf(n);
      out.push(
        warn(
          'REPEAT_NEVER_TRUE',
          `node "${n.id}" repeatUntil is always false — the node runs all ${maxRepeats} passes every time`,
          {
            nodeId: n.id,
            hint: REPEAT_HINT,
            at: { pointer },
            params: { node: n.id, maxRepeats },
          },
        ),
      );
      continue;
    }
    const source = cx
      .sources(index)
      .find((s) => s.field === 'repeatUntil' && s.pointer === pointer);
    if (source === undefined || readsPass(n, source) !== false) continue;
    out.push(
      warn(
        'REPEAT_UNTIL_STATIC',
        `node "${n.id}" repeatUntil does not read this pass's result (output or nodes.${n.id}.output) — it gives the same answer after every pass`,
        {
          nodeId: n.id,
          hint: REPEAT_HINT,
          at: { pointer },
          params: { node: n.id },
        },
      ),
    );
  }
}
