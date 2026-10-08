/**
 * Iteration a run certainly cannot perform.
 *
 *  - FOREACH_NOT_ARRAY (error) — `forEach` is evaluated with the template
 *    rules: without a `{{ }}` it is plain text, text around a template makes
 *    a string, and a template built from literals has one value. None of
 *    them is a list unless that value is, so the node fails every time it
 *    runs. A forEach whose typed value is not a list is TYPE_MISMATCH's (a
 *    warning: the typing reads documentation, not the data).
 *  - AGENT_ITERATION_UNSUPPORTED (error) — an agent node runs one turn; a
 *    live run refuses an agent with forEach or repeatUntil at that node.
 */

import { err } from '../../errors';
import { foldConstant } from '../../syntax/constant';
import { parseExpressionIn } from '../../syntax/parse';
import { ptr } from '../../syntax/pointer';
import {
  exprSegments,
  isSingleTemplate,
  tokenizeTemplate,
} from '../../syntax/tokens';
import type { Issue, NodeDef } from '../../types';
import type { RuleContext } from '../context';
import { forEachMismatch } from './types';

/** The kind of a constant as the messages name it. */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}

const FOREACH_HINT =
  'write forEach as one template that resolves to an array, e.g. "{{ nodes.<id>.output.items }}"';

function notAnArray(n: NodeDef, pointer: string): Issue | null {
  const value = n.forEach ?? '';
  const tokens = tokenizeTemplate(value);
  const exprs = exprSegments(tokens);
  if (exprs.length === 0) {
    const bare = value.trim();
    const parses =
      !value.includes('{{') &&
      bare !== '' &&
      parseExpressionIn(
        value,
        value.indexOf(bare),
        value.indexOf(bare) + bare.length,
      ).ok;
    return err(
      'FOREACH_NOT_ARRAY',
      `node "${n.id}" forEach: "${value}" has no {{ }} template, so it is plain text, not an array — the run fails at this node`,
      {
        nodeId: n.id,
        hint: parses ? `write it as a template: "{{ ${bare} }}"` : FOREACH_HINT,
        at: { pointer },
        params: { node: n.id, reason: 'not-a-template', value },
      },
    );
  }
  if (!isSingleTemplate(value, tokens)) {
    return err(
      'FOREACH_NOT_ARRAY',
      `node "${n.id}" forEach: text around the template makes it a string, not an array — the run fails at this node`,
      {
        nodeId: n.id,
        hint: FOREACH_HINT,
        at: { pointer },
        params: { node: n.id, reason: 'mixed-text', value },
      },
    );
  }
  const segment = exprs[0];
  const start = segment.exprStart ?? segment.start;
  const end = segment.exprEnd ?? segment.end;
  const parsed = parseExpressionIn(value, start, end);
  if (!parsed.ok) return null;
  const folded = foldConstant(parsed.ast);
  if (!folded.ok || Array.isArray(folded.value)) return null;
  const kind = kindOf(folded.value);
  const expr = value.slice(start, end);
  return err(
    'FOREACH_NOT_ARRAY',
    `node "${n.id}" forEach: {{ ${expr} }} is always ${kind}, not an array — the run fails at this node`,
    {
      nodeId: n.id,
      hint: FOREACH_HINT,
      at: { pointer, range: [start, end] },
      params: { node: n.id, reason: 'constant', value, kind },
    },
  );
}

export function iterationRules(cx: RuleContext, out: Issue[]): void {
  for (const n of cx.nodes) {
    const index = cx.indexOf(n);
    if (n.type === 'agent') {
      for (const field of ['forEach', 'repeatUntil'] as const) {
        if (typeof n[field] !== 'string') continue;
        out.push(
          err(
            'AGENT_ITERATION_UNSUPPORTED',
            `node "${n.id}" (agent) uses ${field} — an agent node cannot iterate yet; a live run fails at this node`,
            {
              nodeId: n.id,
              hint: 'give each item its own agent node, or do the per-item work in an llm node',
              at: { pointer: ptr('nodes', index, field) },
              params: { node: n.id, field },
            },
          ),
        );
      }
    }
    if (typeof n.forEach !== 'string') continue;
    const pointer = ptr('nodes', index, 'forEach');
    const certain = notAnArray(n, pointer);
    if (certain !== null) {
      out.push(certain);
      continue;
    }
    const source = cx
      .sources(index)
      .find((s) => s.field === 'forEach' && s.pointer === pointer);
    const unit = source?.units[0];
    if (source === undefined || unit === undefined) continue;
    if (!unit.parse.ok || unit.opaque === true) continue;
    const mismatch = forEachMismatch(cx, n, source, unit, unit.parse.ast);
    if (mismatch !== null) out.push(mismatch);
  }
}
