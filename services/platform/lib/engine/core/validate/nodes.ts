/**
 * Per-node structural validation: ids, types (with a did-you-mean and a
 * catalog pointer), the field allow-list, per-type required fields,
 * control-flow field rules (when/elseOf/forEach/repeatUntil/maxRepeats/
 * onError), payload field types, the llm outputSchema shape, and
 * transform-code checks.
 *
 * Syntax rides the CodeRunner (`checkBody`/`checkExpr`); with no runner
 * installed those checks are skipped silently — they re-run once a backend
 * is wired — and every other rule here is pure.
 */

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { codeRunner, hasCodeRunner } from '../runner';
import { nodeTypes, typeNames, type NodeTypeDef } from '../slots';
import { templateExprsIn } from '../template';
import type { Issue, NodeDef } from '../types';
import { compileSchema } from './schema';
import { closestName } from './similar';

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

/** Transform code runs data-only: no module loading, no network, no host
 * process — these tokens always fail at runtime. */
const CODE_IO_RE = /\b(?:require|import|fetch)\s*\(|\bprocess\s*\./;

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

/** Syntax-check a condition field: `{{ expr }}` templates, or one bare
 * expression when the field has no braces. */
async function checkConditionSyntax(
  field: string,
  source: string,
  id: string | undefined,
  label: string,
  issues: Issue[],
): Promise<void> {
  if (!hasCodeRunner()) return;
  const exprs = source.includes('{{')
    ? templateExprsIn(source)
    : [source.trim()];
  for (const expr of exprs) {
    const syntax = await codeRunner().checkExpr(expr);
    if (syntax !== null) {
      issues.push(
        err(
          'EXPR_SYNTAX',
          `node "${label}" ${field}: bad expression {{ ${expr} }}: ${syntax}`,
          { nodeId: id },
        ),
      );
    }
  }
}

export async function validateNodes(
  rawNodes: unknown[],
  issues: Issue[],
): Promise<{ validNodes: NodeDef[]; ids: Set<string> }> {
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
    if (!isRecord(raw)) {
      issues.push(
        err('NODE_NOT_OBJECT', `${at} must be an object`, { path: at }),
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
          { path: `${at}.id`, hint: 'ids match ^[a-z][a-z0-9_]{0,49}$' },
        ),
      );
    } else if (ids.has(id)) {
      issues.push(
        err('NODE_ID_DUPLICATE', `duplicate node id "${id}"`, { nodeId: id }),
      );
    } else {
      ids.add(id);
    }

    const type = typeof n.type === 'string' ? n.type : undefined;
    const def = type === undefined ? undefined : nodeTypes().get(type);
    if (def === undefined) {
      issues.push(
        err(
          'UNKNOWN_NODE_TYPE',
          `unknown node type ${JSON.stringify(n.type)}`,
          {
            nodeId: id,
            hint: unknownTypeHint(type, id),
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
            { nodeId: id },
          ),
        );
        continue;
      }
      await checkConditionSyntax(f, v, id, label, issues);
    }
    if (n.elseOf !== undefined) {
      if (typeof n.elseOf !== 'string') {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": "elseOf" must be a node id string`,
            {
              nodeId: id,
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
            },
          ),
        );
      }
      if (n.repeatUntil === undefined) {
        issues.push(
          err(
            'NODE_FIELD_TYPE',
            `node "${label}": maxRepeats only makes sense together with repeatUntil`,
            { nodeId: id },
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
        }),
      );
    }
    for (const k of STRING_FIELDS) {
      if (n[k] !== undefined && typeof n[k] !== 'string') {
        issues.push(
          err('NODE_FIELD_TYPE', `node "${label}": "${k}" must be a string`, {
            nodeId: id,
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
            { nodeId: id, hint: `e.g. "${k}": ["document-verify"]` },
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
            },
          ),
        );
      } else {
        try {
          compileSchema(n.outputSchema);
        } catch (e) {
          issues.push(
            err(
              'OUTPUT_SCHEMA_INVALID',
              `node "${label}": "outputSchema" is not a valid JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
              { nodeId: id },
            ),
          );
        }
      }
    }

    // Transform code.
    if (typeof n.code === 'string') {
      if (hasCodeRunner()) {
        const syntax = await codeRunner().checkBody(n.code);
        if (syntax !== null) {
          issues.push(
            err(
              'CODE_SYNTAX',
              `node "${label}": JavaScript syntax error in "code": ${syntax}`,
              {
                nodeId: id,
              },
            ),
          );
        }
      }
      const io = CODE_IO_RE.exec(n.code);
      if (io) {
        issues.push(
          err(
            'CODE_NO_IO',
            `node "${label}": transform code has no network or module access — "${io[0]}" will fail at runtime`,
            {
              nodeId: id,
              hint: 'transforms only reshape data; use a connector node for external calls',
            },
          ),
        );
      }
      if (!/\breturn\b/.test(n.code)) {
        issues.push(
          warn(
            'CODE_NO_RETURN',
            `node "${label}": "code" contains no return statement — the node output will be empty`,
            { nodeId: id, hint: 'end the body with `return <value>`' },
          ),
        );
      }
    }

    if (idOk) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- id and type are verified above; downstream passes re-guard every optional field
      validNodes.push(n as unknown as NodeDef);
    }
  }

  return { validNodes, ids };
}
