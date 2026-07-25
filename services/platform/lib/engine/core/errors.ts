/**
 * The issue-code catalog — single source of truth for every validation and
 * runtime issue the engine can raise.
 *
 * Error text is public API: agents parse it behaviorally, so the full
 * rendered output is golden-tested and any change to a message is a
 * conscious, reviewed decision. Iterating on error text alone measurably
 * lifts author success rates, and hints double as catalog discovery.
 */

import type { Issue } from './types';

/** Every code the engine can emit, with the invariant it protects. */
export const CODES = {
  // Document level.
  AUTOMATION_NOT_OBJECT: 'the document must be a mapping/object',
  UNKNOWN_TOP_FIELD: 'only the documented top-level fields exist',
  VERSION_UNSUPPORTED: 'this engine supports document version 1',
  VERSION_MISSING: 'documents should declare version: 1',
  NAME_INVALID: 'name is required, kebab-case',
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
    'type must be transform | llm | subautomation | a registered capability name',
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

  // Integration contracts.
  INTEGRATION_INPUT_INVALID: 'integration inputs must match their JSON Schema',

  // Document quality.
  OUTPUT_MISSING: 'an automation without output returns null',
  UNUSED_NODE:
    'a node whose output nobody reads and that has no effect is dead',
} as const;

export type IssueCode = keyof typeof CODES;

/** Typo-safe Issue constructors — validators never hand-write codes. */
export function err(
  code: IssueCode,
  message: string,
  extras: { nodeId?: string; path?: string; hint?: string } = {},
): Issue {
  return { level: 'error', code, message, ...extras };
}

export function warn(
  code: IssueCode,
  message: string,
  extras: { nodeId?: string; path?: string; hint?: string } = {},
): Issue {
  return { level: 'warning', code, message, ...extras };
}
