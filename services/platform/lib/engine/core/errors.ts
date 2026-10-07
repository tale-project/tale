/**
 * The issue-code catalog — single source of truth for every validation and
 * runtime issue the engine can raise.
 *
 * Error text is public API: agents parse it behaviorally, so the full
 * rendered output is golden-tested and any change to a message is a
 * conscious, reviewed decision. Iterating on error text alone measurably
 * lifts author success rates, and hints double as catalog discovery.
 */

import type {
  Issue,
  IssueLocation,
  IssueParams,
  RelatedLocation,
} from './types';

/** Every code the engine can emit, with the invariant it protects. */
export const CODES = {
  // Document level.
  AUTOMATION_NOT_OBJECT: 'the document must be a mapping/object',
  UNKNOWN_TOP_FIELD: 'only the documented top-level fields exist',
  VERSION_UNSUPPORTED: 'this engine supports document version 1',
  VERSION_MISSING: 'documents should declare version: 1',
  NAME_INVALID: 'name is required — lowercase slug segments separated by "/"',
  INPUTS_SCHEMA_INVALID: 'inputs must be a valid JSON Schema',
  NODES_MISSING: 'an automation is a non-empty array of nodes',
  NODES_TOO_MANY: 'at most 40 nodes per automation',
  SECRET_IN_DOCUMENT:
    'credentials never live in documents; secrets are injected at runtime',
  TESTS_INVALID: 'tests must be [{name, input, expect?}]',

  // Node level.
  NODE_NOT_OBJECT: 'each node is an object',
  NODE_ID_INVALID: 'node ids are snake_case',
  NODE_ID_DUPLICATE: 'node ids are unique',
  UNKNOWN_NODE_TYPE:
    'type must be transform | llm | agent | subautomation | a registered capability name',
  NODE_UNKNOWN_FIELD: 'nodes accept only their documented fields',
  NODE_MISSING_FIELD: 'required per-type fields must be present',
  NODE_FIELD_TYPE: 'node fields have fixed types',
  CODE_SYNTAX: 'transform code must be valid JavaScript',
  CODE_NO_IO: 'transform code has no network/module access',
  CODE_NO_RETURN: 'transform code must return a value',
  OUTPUT_SCHEMA_INVALID: 'outputSchema must be a valid JSON Schema object',
  ELSEOF_TARGET_INVALID: 'elseOf must name another node that has `when`',
  REPEAT_MAX_INVALID: 'maxRepeats is 1..20',
  ONERROR_INVALID: 'onError is "fail" or "continue"',
  SUBAUTOMATION_REF_INVALID:
    'subautomation references are "name" or "name@version"',
  SUBAUTOMATION_NOT_FOUND: 'subautomation references must resolve in the store',
  SUBAUTOMATION_HAS_AGENT_NODE:
    'a live agent turn spans suspensions, which a subautomation cannot park on',
  SUBAUTOMATION_HAS_WRITE:
    'a subautomation cannot wait for approval, so a gated write inside one fails the run',

  // References & templates.
  EXPR_SYNTAX: 'template expressions must be valid JavaScript expressions',
  REF_UNKNOWN_NODE: 'nodes.<id> references must resolve',
  REF_SELF: 'a node cannot reference itself',
  REF_NOT_OUTPUT: 'node results are read via .output',
  REF_BARE: 'nodes.<id> without .output is almost always a mistake',
  REF_CYCLE: 'the graph must be acyclic',
  REF_UNSTRUCTURED_PATH:
    'an unstructured output has no fields — only .output.text exists, and only as text',
  ITEM_WITHOUT_FOREACH: '`item` exists only under forEach',
  INPUT_KEY_UNKNOWN: 'input.<key> should be declared in the inputs schema',
  TEMPLATE_UNTERMINATED:
    'a "{{" without its closing "}}" is plain text, not a template',

  // Connector contracts.
  CONNECTOR_INPUT_INVALID: 'connector inputs must match their JSON Schema',

  // Models.
  LLM_MODEL_UNAVAILABLE:
    'an llm/agent model should be one a connected provider of the organization serves',

  // Document quality.
  OUTPUT_MISSING: 'an automation without output returns null',
  UNUSED_NODE:
    'a node whose output nobody reads and that has no effect is dead',
} as const;

export type IssueCode = keyof typeof CODES;

export type IssueFamily =
  | 'document'
  | 'node'
  | 'syntax'
  | 'reference'
  | 'type'
  | 'flow'
  | 'contract'
  | 'test'
  | 'quality';

/** What a code is, for readers that render issues without the English
 * message: its level, its family, and the params every issue carries. */
export interface CodeMeta {
  /** The level the engine emits the code at; `varies` for a code whose
   * level depends on where it is raised. */
  level: 'error' | 'warning' | 'varies';
  family: IssueFamily;
  /** Every param name an issue of this code carries; a trailing `?` marks
   * an optional one. */
  params: readonly string[];
  /** Params that hold raw parser or schema-validator English — shown as
   * technical detail, never interpolated into localized text. */
  technical?: readonly string[];
}

/** One entry per code — a code without meta is a type error. */
export const CODE_META: { readonly [K in IssueCode]: CodeMeta } = {
  AUTOMATION_NOT_OBJECT: { level: 'error', family: 'document', params: [] },
  UNKNOWN_TOP_FIELD: {
    level: 'error',
    family: 'document',
    params: ['field', 'allowed'],
  },
  VERSION_UNSUPPORTED: {
    level: 'error',
    family: 'document',
    params: ['version'],
  },
  VERSION_MISSING: { level: 'warning', family: 'document', params: [] },
  NAME_INVALID: { level: 'error', family: 'document', params: ['name?'] },
  INPUTS_SCHEMA_INVALID: {
    level: 'error',
    family: 'document',
    params: ['detail?'],
    technical: ['detail'],
  },
  NODES_MISSING: { level: 'error', family: 'document', params: [] },
  NODES_TOO_MANY: {
    level: 'error',
    family: 'document',
    params: ['count', 'max'],
  },
  SECRET_IN_DOCUMENT: { level: 'error', family: 'document', params: ['kind'] },
  TESTS_INVALID: { level: 'error', family: 'test', params: ['test?', 'keys?'] },
  NODE_NOT_OBJECT: { level: 'error', family: 'node', params: ['index'] },
  NODE_ID_INVALID: { level: 'error', family: 'node', params: ['index', 'id?'] },
  NODE_ID_DUPLICATE: {
    level: 'error',
    family: 'node',
    params: ['node', 'firstIndex'],
  },
  UNKNOWN_NODE_TYPE: {
    level: 'error',
    family: 'node',
    params: ['node?', 'type?', 'suggestion?'],
  },
  NODE_UNKNOWN_FIELD: {
    level: 'error',
    family: 'node',
    params: ['node', 'type', 'field', 'allowed'],
  },
  NODE_MISSING_FIELD: {
    level: 'error',
    family: 'node',
    params: ['node', 'type', 'field'],
  },
  NODE_FIELD_TYPE: {
    level: 'error',
    family: 'node',
    params: ['node', 'field', 'expected'],
  },
  CODE_SYNTAX: {
    level: 'error',
    family: 'syntax',
    params: ['node', 'detail'],
    technical: ['detail'],
  },
  CODE_NO_IO: { level: 'error', family: 'node', params: ['node', 'token'] },
  CODE_NO_RETURN: { level: 'warning', family: 'node', params: ['node'] },
  OUTPUT_SCHEMA_INVALID: {
    level: 'error',
    family: 'node',
    params: ['node', 'detail?'],
    technical: ['detail'],
  },
  ELSEOF_TARGET_INVALID: {
    level: 'error',
    family: 'node',
    params: ['node', 'target', 'reason'],
  },
  REPEAT_MAX_INVALID: {
    level: 'error',
    family: 'node',
    params: ['node', 'value'],
  },
  ONERROR_INVALID: {
    level: 'error',
    family: 'node',
    params: ['node', 'value'],
  },
  SUBAUTOMATION_REF_INVALID: {
    level: 'error',
    family: 'contract',
    params: ['node', 'ref'],
  },
  SUBAUTOMATION_NOT_FOUND: {
    level: 'error',
    family: 'contract',
    params: [
      'node',
      'automation',
      'version?',
      'suggestion?',
      'latest?',
      'known?',
    ],
  },
  SUBAUTOMATION_HAS_AGENT_NODE: {
    level: 'error',
    family: 'contract',
    params: ['node', 'automation', 'childNode'],
  },
  SUBAUTOMATION_HAS_WRITE: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'automation', 'childNode', 'childType'],
  },
  EXPR_SYNTAX: {
    level: 'error',
    family: 'syntax',
    params: ['node?', 'field', 'expr', 'detail'],
    technical: ['detail'],
  },
  REF_UNKNOWN_NODE: {
    level: 'error',
    family: 'reference',
    params: ['node?', 'field', 'ref', 'suggestion?', 'known'],
  },
  REF_SELF: { level: 'error', family: 'reference', params: ['node', 'field'] },
  REF_NOT_OUTPUT: {
    level: 'error',
    family: 'reference',
    params: ['node?', 'field', 'source', 'member'],
  },
  REF_BARE: {
    level: 'warning',
    family: 'reference',
    params: ['node?', 'field', 'source'],
  },
  REF_CYCLE: { level: 'error', family: 'reference', params: ['cycle'] },
  REF_UNSTRUCTURED_PATH: {
    level: 'error',
    family: 'type',
    params: ['node?', 'field', 'source', 'sourceType', 'member'],
  },
  ITEM_WITHOUT_FOREACH: {
    level: 'warning',
    family: 'reference',
    params: ['node', 'field', 'names'],
  },
  INPUT_KEY_UNKNOWN: {
    level: 'warning',
    family: 'reference',
    params: ['node?', 'field', 'key', 'suggestion?', 'declared'],
  },
  TEMPLATE_UNTERMINATED: {
    level: 'warning',
    family: 'syntax',
    params: ['node?', 'field'],
  },
  CONNECTOR_INPUT_INVALID: {
    level: 'error',
    family: 'contract',
    params: ['node', 'type', 'property', 'keyword', 'suggestion?', 'detail'],
    technical: ['detail'],
  },
  LLM_MODEL_UNAVAILABLE: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'model'],
  },
  OUTPUT_MISSING: { level: 'warning', family: 'quality', params: [] },
  UNUSED_NODE: {
    level: 'warning',
    family: 'quality',
    params: ['node', 'reason'],
  },
};

/** Everything an issue carries besides its level, code and message. `at`
 * and `params` are required, so no emitter can forget where an issue is or
 * what its sentence says. */
export interface IssueExtras {
  nodeId?: string;
  path?: string;
  hint?: string;
  at: IssueLocation;
  params: IssueParams;
  related?: readonly RelatedLocation[];
}

/** Typo-safe Issue constructors — validators never hand-write codes. */
export function err(
  code: IssueCode,
  message: string,
  extras: IssueExtras,
): Issue {
  return { level: 'error', code, message, ...extras };
}

export function warn(
  code: IssueCode,
  message: string,
  extras: IssueExtras,
): Issue {
  return { level: 'warning', code, message, ...extras };
}
