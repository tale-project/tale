/**
 * Per-node structural validation: ids, types (with a did-you-mean and a
 * catalog pointer), the field allow-list, per-type required fields,
 * control-flow field rules (when/elseOf/forEach/repeatUntil/maxRepeats/
 * onError), payload field types, the llm outputSchema shape, and
 * transform-code checks.
 *
 * Syntax is parsed (`../syntax`) and a rejection is confirmed by the
 * CodeRunner when one is installed (`./syntax-check`); the transform-code
 * rules read the parsed body, so a `return` in a comment does not count and
 * a `fetch(` inside a string is not a call. Every other rule here is pure.
 */

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { nodeTypes, typeNames, type NodeTypeDef } from '../slots';
import { findIoAccess, hasTopLevelReturn } from '../syntax/body';
import { scopeNamesFor } from '../syntax/globals';
import { ptr } from '../syntax/pointer';
import type { NodeDef } from '../types';
import type { ValidationContext } from './context';
import { compileSchema } from './schema';
import { closestName } from './similar';
import { errorRange, syntaxError } from './syntax-check';

const ID_RE = /^[a-z][a-z0-9_]{0,49}$/;

const CONTROL_FIELDS = [
  'id',
  'type',
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
  'maxRepeats',
  'onError',
];

const STRING_FIELDS = [
  'code',
  'prompt',
  'system',
  'model',
  'harness',
  'automation',
] as const;

/** Agent capability lists: flat arrays of slugs/names. */
const SLUG_LIST_FIELDS = ['skills', 'connectors', 'tools', 'secrets'] as const;

/** A short taste of the registry for hints; the catalog carries the rest. */
function typeSample(): string {
  const names = typeNames();
  return names.slice(0, 8).join(', ') + (names.length > 8 ? ', …' : '');
}

function unknownTypeHint(
  type: string | undefined,
  id: string | undefined,
): string {
  const catalog = `registered types include: ${typeSample()} — search the catalog for the full list`;
  if (type === undefined) return `add a "type"; ${catalog}`;
  if (type.includes('\\')) {
    return `remove the backslash — markdown escaping leaked into the document; write "${type.replaceAll('\\', '')}"`;
  }
  if (type === 'connector' || type === 'connectors') {
    return `set "type" to the capability name itself, e.g. {"id": "${id ?? 'fetch'}", "type": "weather.current", "input": {...}}; ${catalog}`;
  }
  const close = closestName(type, typeNames());
  return `${close === undefined ? '' : `did you mean "${close}"? `}${catalog}`;
}

function requiredFieldHint(
  field: string,
  def: NodeTypeDef,
): string | undefined {
  switch (field) {
    case 'model':
      return 'the model is always explicit — name the exact model to call; the engine never picks one for you';
    case 'prompt':
      return 'e.g. "prompt": "Summarize {{ nodes.fetch.output }}"';
    case 'code':
      return 'e.g. "code": "return input.orders.filter(o => o.total > 100)"';
    case 'automation':
      return 'e.g. "automation": "my-saved-flow" or "my-saved-flow@2"';
    case 'input':
      return def.connector
        ? `provide "input" matching the schema: ${JSON.stringify(def.connector.inputSchema)}`
        : undefined;
    default:
      return undefined;
  }
}

/** The closest registered type name for a misspelled one — absent for the
 * keyword and escaping mistakes, whose hints say something else. */
function typeSuggestion(type: string | undefined): string | undefined {
  if (type === undefined || type.includes('\\')) return undefined;
  if (type === 'connector' || type === 'connectors') return undefined;
  return closestName(type, typeNames());
}

/** A param-safe rendering of an arbitrary field value. */
function shown(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : JSON.stringify(value);
}

/** Syntax-check a control-flow field: its `{{ expr }}` templates, or one
 * bare expression when the field has no braces. */
async function checkControlSyntax(
  ctx: ValidationContext,
  index: number,
  field: 'when' | 'forEach' | 'repeatUntil',
  id: string | undefined,
  label: string,
): Promise<void> {
  for (const source of ctx.sources(index)) {
    if (source.field !== field) continue;
    for (const unit of source.units) {
      const detail = await syntaxError(unit, 'expr');
      if (detail === null) continue;
      ctx.issues.push(
        err(
          'EXPR_SYNTAX',
          `node "${label}" ${field}: bad expression {{ ${unit.source} }}: ${detail}`,
          {
            nodeId: id,
            at: { pointer: source.pointer, range: errorRange(unit) },
            params: {
              ...(id !== undefined && { node: id }),
              field,
              expr: unit.source,
              detail,
            },
          },
        ),
      );
    }
  }
}

export async function validateNodes(
  ctx: ValidationContext,
): Promise<{ validNodes: NodeDef[]; ids: Set<string> }> {
  const { rawNodes, issues } = ctx;
  const ids = new Set<string>();
  const validNodes: NodeDef[] = [];

  // elseOf targets resolve against the raw sibling list, so a partner with
  // unrelated problems of its own still counts as having `when`.
  const withWhen = new Set<string>();
  for (const raw of rawNodes) {
    if (
      isRecord(raw) &&
      typeof raw.id === 'string' &&
      typeof raw.when === 'string'
    ) {
      withWhen.add(raw.id);
    }
  }

  for (const [i, raw] of rawNodes.entries()) {
    const at = `nodes[${i}]`;
    const base = ptr('nodes', i);
    if (!isRecord(raw)) {
      issues.push(
        err('NODE_NOT_OBJECT', `${at} must be an object`, {
          path: at,
          at: { pointer: base },
          params: { index: i },
        }),
      );
      continue;
    }
    const n = raw;

    const id = typeof n.id === 'string' ? n.id : undefined;
    const idOk = id !== undefined && ID_RE.test(id);
    const label = id ?? at;
    if (!idOk) {
      issues.push(
        err(
          'NODE_ID_INVALID',
          `${at} needs an "id" in snake_case (got ${JSON.stringify(n.id)})`,
          {
            path: `${at}.id`,
            hint: 'ids match ^[a-z][a-z0-9_]{0,49}$',
            at: {
              pointer: `${base}/id`,
              ...(n.id === undefined && { subject: 'missing' as const }),
            },
            params: { index: i, ...(id !== undefined && { id }) },
          },
        ),
      );
    } else if (ids.has(id)) {
      const firstIndex = ctx.indexById.get(id) ?? i;
      issues.push(
        err('NODE_ID_DUPLICATE', `duplicate node id "${id}"`, {
          nodeId: id,
          at: { pointer: `${base}/id` },
          params: { node: id, firstIndex },
          related: [
            {
              role: 'partner',
              nodeId: id,
              at: { pointer: ptr('nodes', firstIndex, 'id') },
            },
          ],
        }),
      );
    } else {
      ids.add(id);
    }

    const type = typeof n.type === 'string' ? n.type : undefined;
    const def = type === undefined ? undefined : nodeTypes().get(type);
    if (def === undefined) {
      const suggestion = typeSuggestion(type);
      issues.push(
        err(
          'UNKNOWN_NODE_TYPE',
          `unknown node type ${JSON.stringify(n.type)}`,
          {
            nodeId: id,
            hint: unknownTypeHint(type, id),
            at: {
              pointer: `${base}/type`,
              ...(n.type === undefined && { subject: 'missing' as const }),
            },
            params: {
              ...(id !== undefined && { node: id }),
              ...(type !== undefined && { type }),
              ...(suggestion !== undefined && { suggestion }),
            },
          },
        ),
      );
      continue;
    }

    const allowed = new Set([...CONTROL_FIELDS, ...def.allowedFields]);
    for (const k of Object.keys(n)) {
      if (!allowed.has(k)) {
        issues.push(
          err(
            'NODE_UNKNOWN_FIELD',
            `node "${label}" (${type}): unknown field "${k}"`,
            {
              nodeId: id,
              path: `${at}.${k}`,
              hint:
                def.kind === 'connector'
                  ? `connector data goes inside "input" — allowed fields: ${[...allowed].join(', ')}`
                  : `allowed fields: ${[...allowed].join(', ')}`,
              at: { pointer: `${base}${ptr(k)}`, subject: 'key' },
              params: {
                node: label,
                type: def.type,
                field: k,
                allowed: [...allowed],
              },
            },
          ),
        );
      }
    }
    for (const k of def.requiredFields) {
      if (n[k] === undefined) {
        issues.push(
          err(
            'NODE_MISSING_FIELD',
            `node "${label}" (${type}): missing required field "${k}"`,
            {
              nodeId: id,
              hint: requiredFieldHint(k, def),
              at: { pointer: `${base}${ptr(k)}`, subject: 'missing' },
              params: { node: label, type: def.type, field: k },
            },
          ),
        );
      }
    }

    // Control-flow fields.
    for (const f of ['when', 'forEach', 'repeatUntil'] as const) {
      const v = n[f];
      if (v === undefined) continue;
      if (typeof v !== 'string') {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": "${f}" must be a template string like "{{ nodes.check.output.ok }}"`,
            {
              nodeId: id,
              at: { pointer: `${base}/${f}` },
              params: { node: label, field: f, expected: 'template' },
            },
          ),
        );
        continue;
      }
      await checkControlSyntax(ctx, i, f, id, label);
    }
    if (n.elseOf !== undefined) {
      if (typeof n.elseOf !== 'string') {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": "elseOf" must be a node id string`,
            {
              nodeId: id,
              at: { pointer: `${base}/elseOf` },
              params: { node: label, field: 'elseOf', expected: 'node-id' },
            },
          ),
        );
      } else if (n.elseOf === id) {
        issues.push(
          err(
            'ELSEOF_TARGET_INVALID',
            `node "${label}": elseOf cannot reference itself`,
            {
              nodeId: id,
              at: { pointer: `${base}/elseOf` },
              params: { node: label, target: n.elseOf, reason: 'self' },
            },
          ),
        );
      } else if (!withWhen.has(n.elseOf)) {
        issues.push(
          err(
            'ELSEOF_TARGET_INVALID',
            `node "${label}": elseOf target "${n.elseOf}" must be another node that has a "when" condition`,
            {
              nodeId: id,
              hint: 'elseOf runs exactly when its partner was when-skipped',
              at: { pointer: `${base}/elseOf` },
              params: { node: label, target: n.elseOf, reason: 'no-when' },
            },
          ),
        );
      }
    }
    if (n.maxRepeats !== undefined) {
      if (
        typeof n.maxRepeats !== 'number' ||
        !Number.isInteger(n.maxRepeats) ||
        n.maxRepeats < 1 ||
        n.maxRepeats > 20
      ) {
        issues.push(
          err(
            'REPEAT_MAX_INVALID',
            `node "${label}": maxRepeats must be an integer 1..20`,
            {
              nodeId: id,
              at: { pointer: `${base}/maxRepeats` },
              params: { node: label, value: shown(n.maxRepeats) },
            },
          ),
        );
      }
      if (n.repeatUntil === undefined) {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": maxRepeats only makes sense together with repeatUntil`,
            {
              nodeId: id,
              at: { pointer: `${base}/maxRepeats` },
              params: {
                node: label,
                field: 'maxRepeats',
                expected: 'repeatUntil',
              },
            },
          ),
        );
      }
    }
    if (
      n.onError !== undefined &&
      n.onError !== 'fail' &&
      n.onError !== 'continue'
    ) {
      issues.push(
        err(
          'ONERROR_INVALID',
          `node "${label}": "onError" must be "fail" or "continue"`,
          {
            nodeId: id,
            at: { pointer: `${base}/onError` },
            params: { node: label, value: shown(n.onError) },
          },
        ),
      );
    }
    // Payload field types.
    if (n.input !== undefined && !isRecord(n.input)) {
      issues.push(
        err('NODE_FIELD_TYPE', `node "${label}": "input" must be an object`, {
          nodeId: id,
          hint: 'put templates in its values: "input": {"city": "{{ input.city }}"}',
          at: { pointer: `${base}/input` },
          params: { node: label, field: 'input', expected: 'object' },
        }),
      );
    }
    for (const k of STRING_FIELDS) {
      if (n[k] !== undefined && typeof n[k] !== 'string') {
        issues.push(
          err('NODE_FIELD_TYPE', `node "${label}": "${k}" must be a string`, {
            nodeId: id,
            at: { pointer: `${base}/${k}` },
            params: { node: label, field: k, expected: 'string' },
          }),
        );
      }
    }
    for (const k of SLUG_LIST_FIELDS) {
      const v = n[k];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": "${k}" must be an array of slugs`,
            {
              nodeId: id,
              hint: `e.g. "${k}": ["document-verify"]`,
              at: { pointer: `${base}/${k}` },
              params: { node: label, field: k, expected: 'string-array' },
            },
          ),
        );
      }
    }
    if (n.files !== undefined && !isRecord(n.files)) {
      issues.push(
        err(
          'NODE_FIELD_TYPE',
          `node "${label}": "files" must be an object mapping mount names to file or folder references`,
          {
            nodeId: id,
            hint: 'e.g. "files": {"setup": "{{ input.setupFolderId }}"}',
            at: { pointer: `${base}/files` },
            params: { node: label, field: 'files', expected: 'files-map' },
          },
        ),
      );
    }
    if (allowed.has('outputSchema') && n.outputSchema !== undefined) {
      if (!isRecord(n.outputSchema)) {
        issues.push(
          err(
            'OUTPUT_SCHEMA_INVALID',
            `node "${label}": "outputSchema" must be a JSON Schema object`,
            {
              nodeId: id,
              hint: 'e.g. "outputSchema": {"type": "object", "properties": {"headline": {"type": "string"}}}',
              at: { pointer: `${base}/outputSchema` },
              params: { node: label },
            },
          ),
        );
      } else {
        try {
          compileSchema(n.outputSchema);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          issues.push(
            err(
              'OUTPUT_SCHEMA_INVALID',
              `node "${label}": "outputSchema" is not a valid JSON Schema: ${detail}`,
              {
                nodeId: id,
                at: { pointer: `${base}/outputSchema` },
                params: { node: label, detail },
              },
            ),
          );
        }
      }
    }

    // Transform code.
    if (typeof n.code === 'string') {
      const pointer = `${base}/code`;
      const code = ctx
        .sources(i)
        .find((source) => source.field === 'code')
        ?.units.at(0);
      const detail =
        code === undefined ? null : await syntaxError(code, 'body');
      if (code !== undefined && detail !== null) {
        issues.push(
          err(
            'CODE_SYNTAX',
            `node "${label}": JavaScript syntax error in "code": ${detail}`,
            {
              nodeId: id,
              at: { pointer, range: errorRange(code) },
              params: { node: label, detail },
            },
          ),
        );
      }
      // The body rules need the parsed body; code acorn cannot read (a
      // syntax error, or valid code only the runner compiles) skips them.
      if (code?.parse.ok === true) {
        const io = findIoAccess(code.parse.ast, n.code, scopeNamesFor('code'));
        if (io !== null) {
          issues.push(
            err(
              'CODE_NO_IO',
              `node "${label}": transform code has no network or module access — "${io.token}" will fail at runtime`,
              {
                nodeId: id,
                hint: 'transforms only reshape data; use a connector node for external calls',
                at: { pointer, range: io.range },
                params: { node: label, token: io.token },
              },
            ),
          );
        }
        if (!hasTopLevelReturn(code.parse.ast)) {
          issues.push(
            warn(
              'CODE_NO_RETURN',
              `node "${label}": "code" contains no return statement — the node output will be empty`,
              {
                nodeId: id,
                hint: 'end the body with `return <value>`',
                at: { pointer },
                params: { node: label },
              },
            ),
          );
        }
      }
    }

    if (idOk) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- id and type are verified above; downstream passes re-guard every optional field
      validNodes.push(n as unknown as NodeDef);
    }
  }

  return { validNodes, ids };
}
