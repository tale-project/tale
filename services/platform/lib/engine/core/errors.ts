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
  TESTS_INVALID:
    'tests must be [{name, description?, input, mocks?, failures?, expect?}]',

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
  EXPR_UNKNOWN_NAME: 'expressions use only the names their field provides',
  ITEM_OUT_OF_SCOPE:
    '`item` and `index` do not exist in when or forEach, which are evaluated before the items are',

  // Types.
  REF_UNKNOWN_FIELD: 'a reference reads only fields its data can have',
  TYPE_MISMATCH: 'a value has the type the place it reaches accepts',
  TEMPLATE_NULL_INTERPOLATION:
    'a value placed inside text is never missing — a missing one fails the node',

  // Flow.
  FOREACH_NOT_ARRAY: 'forEach is one template that resolves to an array',
  AGENT_ITERATION_UNSUPPORTED:
    'an agent node runs one turn — it cannot iterate (forEach/repeatUntil) yet',
  MAYBE_NULL:
    'a condition or the output reads fields of a node that may be skipped only behind a guard',
  UNCAUGHT_FAILURE:
    'a failure tolerated with onError: continue does not resurface in a condition or the output',
  UNREACHABLE: 'every node runs on some way a run can go',
  CONDITION_CONSTANT: 'a condition depends on the run',
  REPEAT_NEVER_TRUE: 'repeatUntil can become true',
  REPEAT_UNTIL_STATIC: 'repeatUntil reads the result of the pass it judges',
  OUTPUT_MAYBE_EMPTY:
    'the output reads a node that runs on every way a run can go',

  // Connector contracts.
  CONNECTOR_INPUT_INVALID: 'connector inputs must match their JSON Schema',
  SUBAUTOMATION_INPUT_INVALID:
    "a subautomation's input matches the inputs schema of the automation it calls",
  TRIGGER_INPUT_MISMATCH:
    "the inputs schema accepts the input the automation's triggers start runs with",
  TRIGGER_INPUT_NOT_TEMPLATED:
    "a trigger's fixed input is plain data; a template in it is never evaluated",

  // Tests.
  TESTS_INPUT_INVALID: 'a test input matches the inputs schema',
  TESTS_EFFECT_UNKNOWN:
    'a test expects only effects a node of the automation performs',
  TESTS_EXPECT_TYPE:
    'a test expects output values of the types the automation returns',
  TESTS_TOO_MANY: 'an automation carries at most 50 tests',
  TESTS_UNKNOWN_FIELD:
    'a test has only name, description, input, mocks, failures and expect, and an effect it expects only connector, node, input, inputIncludes and absent',
  TESTS_NAME_DUPLICATE: 'every test has its own name',
  TESTS_MOCK_UNKNOWN_NODE:
    "a test simulates only the outputs and failures of the automation's nodes",
  TESTS_MOCK_CONFLICT:
    'a test simulates either an output or a failure for a node, not both',
  TESTS_MOCK_NOT_LIST:
    'a simulated output of a node that runs once per item is a list, one entry per item',
  TESTS_MOCK_TYPE: 'a simulated output has the shape the node really returns',
  TESTS_EXPECT_NODE_UNKNOWN: "a test names only the automation's nodes",
  TESTS_EXPECT_PATH_IMPOSSIBLE:
    'a test expects of its nodes what some run of the automation does',
  TESTS_EXPECT_FAILURE_IMPOSSIBLE:
    'a test expects the run to fail only at a node whose failure stops it',

  // Models.
  LLM_MODEL_UNAVAILABLE:
    'an llm/agent model should be one a connected provider of the organization serves',

  // What the organization has.
  SKILL_UNKNOWN:
    "an agent step's skills should be skills a run of the automation can reach",
  CONNECTOR_NOT_CONNECTED:
    'a connector a step uses should be one the organization connected',
  SECRET_UNKNOWN:
    "an agent step's secrets should be secrets the organization stored",
  HARNESS_UNKNOWN:
    "an agent step's runtime should be one this deployment can run",
  EVENT_UNKNOWN:
    'an event trigger should wait for an event the platform raises',

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
  // `kind` describes the hit in English ("API key (sk-…)").
  SECRET_IN_DOCUMENT: {
    level: 'error',
    family: 'document',
    params: ['kind'],
    technical: ['kind'],
  },
  // `part` names what of a test is malformed (`mocks`, `effectInput`, …);
  // absent for a test that is not written as one, or unknown expect keys.
  TESTS_INVALID: {
    level: 'error',
    family: 'test',
    params: ['test?', 'keys?', 'part?'],
  },
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
  // An error in templates and conditions (a ReferenceError there); a warning
  // in transform code, which always declares both names (they read
  // undefined outside forEach).
  ITEM_WITHOUT_FOREACH: {
    level: 'varies',
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
  EXPR_UNKNOWN_NAME: {
    level: 'warning',
    family: 'reference',
    params: ['node?', 'field', 'name', 'available', 'suggestion?'],
  },
  ITEM_OUT_OF_SCOPE: {
    level: 'error',
    family: 'reference',
    params: ['node', 'field', 'name'],
  },
  REF_UNKNOWN_FIELD: {
    level: 'warning',
    family: 'type',
    params: [
      'node?',
      'field',
      'ref',
      'root',
      'source?',
      'key',
      'known',
      'suggestion?',
      'closed',
      'listWrapped',
    ],
  },
  TYPE_MISMATCH: {
    level: 'warning',
    family: 'type',
    params: [
      'node',
      'consumer',
      'property?',
      'expr',
      'expected',
      'actual',
      'suggestion?',
      'automation?',
    ],
  },
  TEMPLATE_NULL_INTERPOLATION: {
    level: 'warning',
    family: 'type',
    params: ['node?', 'field', 'expr', 'why', 'key?'],
  },
  FOREACH_NOT_ARRAY: {
    level: 'error',
    family: 'flow',
    params: ['node', 'reason', 'value', 'kind?'],
  },
  AGENT_ITERATION_UNSUPPORTED: {
    level: 'error',
    family: 'node',
    params: ['node', 'field'],
  },
  MAYBE_NULL: {
    level: 'warning',
    family: 'flow',
    params: [
      'node?',
      'field',
      'ref',
      'source',
      'reasons',
      'via?',
      'partner?',
      'suggestion',
    ],
  },
  UNCAUGHT_FAILURE: {
    level: 'warning',
    family: 'flow',
    params: [
      'node?',
      'field',
      'ref',
      'source',
      'failing',
      'reasons',
      'suggestion',
    ],
  },
  UNREACHABLE: {
    level: 'warning',
    family: 'flow',
    params: ['node', 'cause', 'via?', 'partner?', 'a?', 'b?', 'value?'],
  },
  CONDITION_CONSTANT: {
    level: 'warning',
    family: 'flow',
    params: ['node', 'field', 'value', 'cause'],
  },
  REPEAT_NEVER_TRUE: {
    level: 'warning',
    family: 'flow',
    params: ['node', 'maxRepeats'],
  },
  REPEAT_UNTIL_STATIC: { level: 'warning', family: 'flow', params: ['node'] },
  OUTPUT_MAYBE_EMPTY: {
    level: 'warning',
    family: 'flow',
    params: ['nodes', 'root', 'rootReason'],
  },
  CONNECTOR_INPUT_INVALID: {
    level: 'error',
    family: 'contract',
    params: ['node', 'type', 'property', 'keyword', 'suggestion?', 'detail'],
    technical: ['detail'],
  },
  SUBAUTOMATION_INPUT_INVALID: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'automation', 'version', 'missing', 'unknown', 'problems'],
    technical: ['problems'],
  },
  TRIGGER_INPUT_MISMATCH: {
    level: 'warning',
    family: 'contract',
    params: ['kind', 'missing', 'problems'],
    technical: ['problems'],
  },
  TRIGGER_INPUT_NOT_TEMPLATED: {
    level: 'warning',
    family: 'contract',
    params: ['paths'],
  },
  TESTS_INPUT_INVALID: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'missing', 'problems'],
    technical: ['problems'],
  },
  TESTS_EFFECT_UNKNOWN: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'connector', 'suggestion?', 'possible'],
  },
  // `property`: the place in the output as the message writes it after
  // `output` (`.rows[0]`, `[1].id`), empty for the output itself.
  TESTS_EXPECT_TYPE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'property', 'expected', 'actual'],
  },
  TESTS_TOO_MANY: {
    level: 'error',
    family: 'test',
    params: ['count', 'max'],
  },
  // `effect`: the place of the expected effect the field is in, absent for
  // a field of the test itself.
  TESTS_UNKNOWN_FIELD: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'field', 'effect?', 'suggestion?'],
  },
  TESTS_NAME_DUPLICATE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'firstIndex'],
  },
  // `field` is `mocks` or `failures`; `nodes` lists the automation's own.
  TESTS_MOCK_UNKNOWN_NODE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'field', 'node', 'suggestion?', 'nodes'],
  },
  TESTS_MOCK_CONFLICT: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'node'],
  },
  // `kind` is the kind of value the stand-in is (`object`, `string`, …).
  TESTS_MOCK_NOT_LIST: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'node', 'kind'],
  },
  // `expected` is what the node returns there, `actual` what the test
  // gives, each as a type; `property` is written as for TESTS_EXPECT_TYPE.
  TESTS_MOCK_TYPE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'node', 'property', 'expected', 'actual'],
  },
  TESTS_EXPECT_NODE_UNKNOWN: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'node', 'suggestion?'],
  },
  // `reason`: never-together (`a` and `b` never both run), cannot-fail,
  // always-runs or never-runs (each about `node`); `via`: the node whose
  // simulated failure rules the states out, where the automation without
  // the test's failures would give them.
  TESTS_EXPECT_PATH_IMPOSSIBLE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'reason', 'node?', 'a?', 'b?', 'via?'],
  },
  // `cause`: continues (the node has onError: continue) or unreachable.
  TESTS_EXPECT_FAILURE_IMPOSSIBLE: {
    level: 'warning',
    family: 'test',
    params: ['test', 'name', 'node', 'cause'],
  },
  LLM_MODEL_UNAVAILABLE: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'model'],
  },
  SKILL_UNKNOWN: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'skill', 'suggestion?'],
  },
  // `catalogued` is false for a name this deployment has no connector by.
  CONNECTOR_NOT_CONNECTED: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'connector', 'catalogued', 'suggestion?'],
  },
  SECRET_UNKNOWN: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'secret', 'suggestion?'],
  },
  HARNESS_UNKNOWN: {
    level: 'warning',
    family: 'contract',
    params: ['node', 'harness', 'available'],
  },
  EVENT_UNKNOWN: {
    level: 'warning',
    family: 'contract',
    params: ['event', 'suggestion?'],
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
