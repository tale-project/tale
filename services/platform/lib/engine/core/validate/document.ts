/**
 * Document-level validation: top-level shape, versioning, name, the inputs
 * schema, the tests block, and the credential scan.
 *
 * Secrets never live in documents — they are configured on connectors and
 * injected into live() calls at runtime — so any credential-looking string
 * is an error. The scan is deliberately conservative: well-known token
 * shapes, bearer headers, and opaque values under credential-named keys.
 * Ordinary prose never matches.
 */

import type { ValidateFunction } from 'ajv';

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import { credentialKind } from '../secret-patterns';
import { ptr } from '../syntax/pointer';
import type { Issue } from '../types';
import { AUTOMATION_NAME_RULE, isValidAutomationName } from './name';
import {
  compileSchema,
  describeSchemaErrors,
  inputRefusalMessage,
} from './schema';

const TOP_FIELDS = [
  'version',
  'name',
  'description',
  'inputs',
  'nodes',
  'output',
  'tests',
  'ui',
];

export function validateDocument(
  doc: Record<string, unknown>,
  issues: Issue[],
): void {
  for (const k of Object.keys(doc)) {
    if (!TOP_FIELDS.includes(k)) {
      issues.push(
        err('UNKNOWN_TOP_FIELD', `unknown top-level field "${k}"`, {
          path: k,
          hint:
            k === 'edges' || k === 'connections'
              ? 'remove it — edges are derived automatically from {{ nodes.<id>.output }} references'
              : `allowed fields: ${TOP_FIELDS.join(', ')}`,
          at: { pointer: ptr(k), subject: 'key' },
          params: { field: k, allowed: TOP_FIELDS },
        }),
      );
    }
  }

  if (doc.version === undefined) {
    issues.push(
      warn('VERSION_MISSING', 'document has no "version" field', {
        path: 'version',
        hint: 'add version: 1',
        at: { pointer: '/version', subject: 'missing' },
        params: {},
      }),
    );
  } else if (doc.version !== 1) {
    issues.push(
      err(
        'VERSION_UNSUPPORTED',
        `unsupported document version ${JSON.stringify(doc.version)} — this engine supports version 1`,
        {
          path: 'version',
          at: { pointer: '/version' },
          params: { version: JSON.stringify(doc.version) },
        },
      ),
    );
  }

  // The name is the store identity and the subautomation reference — one
  // grammar (`./name`) for every surface, so a document the validator passes
  // is a name the platform can save and address.
  if (!isValidAutomationName(doc.name)) {
    issues.push(
      err('NAME_INVALID', `"name" is required — ${AUTOMATION_NAME_RULE}`, {
        path: 'name',
        hint: 'lowercase letters and digits; "-" or "_" between words inside a segment, "/" between segments; at most 200 characters',
        at: {
          pointer: '/name',
          ...(doc.name === undefined && { subject: 'missing' as const }),
        },
        params: typeof doc.name === 'string' ? { name: doc.name } : {},
      }),
    );
  }

  if (doc.inputs !== undefined) {
    if (!isRecord(doc.inputs)) {
      issues.push(
        err('INPUTS_SCHEMA_INVALID', '"inputs" must be a JSON Schema object', {
          path: 'inputs',
          at: { pointer: '/inputs' },
          params: {},
        }),
      );
    } else {
      try {
        compileSchema(doc.inputs);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        issues.push(
          err(
            'INPUTS_SCHEMA_INVALID',
            `"inputs" is not a valid JSON Schema: ${detail}`,
            {
              path: 'inputs',
              at: { pointer: '/inputs' },
              params: { detail },
            },
          ),
        );
      }
    }
  }

  if (doc.tests !== undefined) validateTests(doc.tests, doc.inputs, issues);

  scanForSecrets(doc, issues);
}

/** The run-input check a test's input meets first; null when there is
 * none to meet (no inputs schema, or one that does not compile — that is
 * INPUTS_SCHEMA_INVALID's). */
export function inputCheck(inputs: unknown): ValidateFunction | null {
  if (!isRecord(inputs)) return null;
  try {
    return compileSchema(inputs);
  } catch (e) {
    console.warn(
      '[engine] skipping the test input check (the inputs schema does not compile):',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** What `expect` may hold. */
const EXPECT_FIELDS = [
  'output',
  'outputIncludes',
  'effects',
  'nodes',
  'failure',
] as const;

/** The states `expect.nodes` names. */
const NODE_STATES: ReadonlySet<unknown> = new Set(['ran', 'skipped', 'failed']);

/** The longest message a simulated failure may carry. */
const MAX_FAILURE_MESSAGE = 2000;

/** The grammar a malformed test is pointed to. */
const TEST_GRAMMAR =
  'a test is {name, description?, input, mocks?: {<node>: <its output>}, failures?: {<node>: <error message>}, expect?: {output?, outputIncludes?, effects?: [{connector, node?, input?, inputIncludes?, absent?: true}], nodes?: {<node>: ran | skipped | failed}, failure?: {node?, message?}}}';

/** Which part of a test is malformed — what a localized sentence names. */
type TestPart =
  | 'description'
  | 'mocks'
  | 'failures'
  | 'effects'
  | 'effect'
  | 'effectInput'
  | 'effectAbsent'
  | 'nodes'
  | 'failure'
  | 'failureWithOutput';

function validateTests(tests: unknown, inputs: unknown, issues: Issue[]): void {
  if (!Array.isArray(tests)) {
    issues.push(
      err(
        'TESTS_INVALID',
        '"tests" must be an array of {name, input, expect?}',
        {
          path: 'tests',
          at: { pointer: '/tests' },
          params: {},
        },
      ),
    );
    return;
  }
  // Compiled once, on the first test that has an input to check.
  let check: ValidateFunction | null | undefined;
  for (const [i, t] of tests.entries()) {
    if (!isRecord(t) || typeof t.name !== 'string' || !('input' in t)) {
      issues.push(
        err(
          'TESTS_INVALID',
          `tests[${i}] must be {name: string, input, expect?}`,
          {
            path: `tests[${i}]`,
            at: { pointer: ptr('tests', i) },
            params: { test: i },
          },
        ),
      );
      continue;
    }
    if (check === undefined) check = inputCheck(inputs);
    if (check !== null) {
      const refused = testInputRefusal(i, t.name, t.input, check);
      if (refused !== null) issues.push(refused.issue);
    }
    validateStandIns(i, t, issues);
    if (t.expect === undefined) continue;
    const keys = isRecord(t.expect) ? Object.keys(t.expect) : [];
    const bad = keys.filter(
      (k) => !(EXPECT_FIELDS as readonly string[]).includes(k),
    );
    if (!isRecord(t.expect) || bad.length > 0) {
      issues.push(
        err(
          'TESTS_INVALID',
          `tests[${i}].expect has unknown key(s): ${bad.join(', ') || JSON.stringify(t.expect)}`,
          {
            path: `tests[${i}].expect`,
            hint: 'expect supports {output?, outputIncludes?, effects?: [{connector, node?, input?, inputIncludes?, absent?: true}], nodes?: {<node>: ran | skipped | failed}, failure?: {node?, message?}}',
            at: { pointer: ptr('tests', i, 'expect') },
            params: { test: i, keys: bad },
          },
        ),
      );
    }
    if (isRecord(t.expect)) validateExpect(i, t.expect, issues);
  }
}

/** One malformed part of test `index`, at `pointer`. */
function malformed(
  index: number,
  part: TestPart,
  message: string,
  pointer: string,
): Issue {
  return err('TESTS_INVALID', message, {
    path: `tests[${index}]`,
    hint: TEST_GRAMMAR,
    at: { pointer },
    params: { test: index, part },
  });
}

/** A test's description and its stand-ins: text, and maps from node ids to
 * outputs and to failure messages. */
function validateStandIns(
  i: number,
  t: Record<string, unknown>,
  issues: Issue[],
): void {
  if (t.description !== undefined && typeof t.description !== 'string') {
    issues.push(
      malformed(
        i,
        'description',
        `tests[${i}].description must be text`,
        ptr('tests', i, 'description'),
      ),
    );
  }
  if (t.mocks !== undefined && !isRecord(t.mocks)) {
    issues.push(
      malformed(
        i,
        'mocks',
        `tests[${i}].mocks must map node ids to the output each returns in this test`,
        ptr('tests', i, 'mocks'),
      ),
    );
  }
  if (t.failures !== undefined) {
    const entry = isRecord(t.failures)
      ? Object.entries(t.failures).find(
          ([, message]) =>
            typeof message !== 'string' || message.length > MAX_FAILURE_MESSAGE,
        )
      : undefined;
    if (!isRecord(t.failures) || entry !== undefined) {
      issues.push(
        malformed(
          i,
          'failures',
          `tests[${i}].failures must map node ids to error messages, each text of at most ${MAX_FAILURE_MESSAGE} characters`,
          entry === undefined
            ? ptr('tests', i, 'failures')
            : ptr('tests', i, 'failures', entry[0]),
        ),
      );
    }
  }
}

/** The parts of `expect` beside its keys: effect entries, node states and
 * the expected failure. */
function validateExpect(
  i: number,
  expect: Record<string, unknown>,
  issues: Issue[],
): void {
  if (expect.effects !== undefined) {
    if (!Array.isArray(expect.effects)) {
      issues.push(
        malformed(
          i,
          'effects',
          `tests[${i}].expect.effects must be a list of {connector, node?, input?, inputIncludes?, absent?}`,
          ptr('tests', i, 'expect', 'effects'),
        ),
      );
    } else {
      for (const [j, effect] of expect.effects.entries()) {
        const at = ptr('tests', i, 'expect', 'effects', j);
        if (
          !isRecord(effect) ||
          typeof effect.connector !== 'string' ||
          (effect.node !== undefined && typeof effect.node !== 'string')
        ) {
          issues.push(
            malformed(
              i,
              'effect',
              `tests[${i}].expect.effects[${j}] must name its connector: {connector: string, node?: string, …}`,
              at,
            ),
          );
        } else if (
          effect.input !== undefined &&
          effect.inputIncludes !== undefined
        ) {
          issues.push(
            malformed(
              i,
              'effectInput',
              `tests[${i}].expect.effects[${j}] gives both input and inputIncludes — compare its input exactly or by inclusion, not both`,
              at,
            ),
          );
        } else if (effect.absent !== undefined && effect.absent !== true) {
          issues.push(
            malformed(
              i,
              'effectAbsent',
              `tests[${i}].expect.effects[${j}].absent must be true when it is given`,
              `${at}/absent`,
            ),
          );
        }
      }
    }
  }
  if (expect.nodes !== undefined) {
    const entry = isRecord(expect.nodes)
      ? Object.entries(expect.nodes).find(
          ([, state]) => !NODE_STATES.has(state),
        )
      : undefined;
    if (!isRecord(expect.nodes) || entry !== undefined) {
      issues.push(
        malformed(
          i,
          'nodes',
          `tests[${i}].expect.nodes must map node ids to ran, skipped or failed`,
          entry === undefined
            ? ptr('tests', i, 'expect', 'nodes')
            : ptr('tests', i, 'expect', 'nodes', entry[0]),
        ),
      );
    }
  }
  if (expect.failure !== undefined) {
    const failure = expect.failure;
    const fits =
      isRecord(failure) &&
      Object.keys(failure).every((k) => k === 'node' || k === 'message') &&
      (failure.node === undefined || typeof failure.node === 'string') &&
      (failure.message === undefined || typeof failure.message === 'string');
    const at = ptr('tests', i, 'expect', 'failure');
    if (!fits) {
      issues.push(
        malformed(
          i,
          'failure',
          `tests[${i}].expect.failure must be {node?: string, message?: string}`,
          at,
        ),
      );
    }
    const output = (['output', 'outputIncludes'] as const).filter(
      (k) => expect[k] !== undefined,
    );
    if (output.length > 0) {
      issues.push(
        malformed(
          i,
          'failureWithOutput',
          `tests[${i}].expect has failure and ${output.join(' and ')} — a run that must fail has no output to compare`,
          at,
        ),
      );
    }
  }
}

/**
 * A test's input against the inputs schema: a run checks its input before
 * any node runs, so an input the schema refuses fails the test before it
 * tests anything. Answers the issue that says so and the words the run
 * refuses the input with; null when the input fits.
 */
export function testInputRefusal(
  index: number,
  name: string,
  input: unknown,
  check: ValidateFunction,
): { issue: Issue; runMessage: string } | null {
  if (check(input)) return null;
  const errors = check.errors ?? [];
  const described = describeSchemaErrors(errors);
  const missing = described
    .filter((_, k) => errors[k]?.keyword === 'required')
    .map((d) => d.path);
  const problems = described.map((d) =>
    d.path === '' ? d.message : `${d.path} ${d.message}`,
  );
  return {
    issue: warn(
      'TESTS_INPUT_INVALID',
      `tests[${index}] "${name}": input does not match the inputs schema: ${problems.join('; ')}`,
      {
        hint: 'the run refuses this input before any node runs, so the test cannot pass',
        at: { pointer: ptr('tests', index, 'input') },
        params: { test: index, name, missing, problems },
      },
    ),
    runMessage: inputRefusalMessage(errors),
  };
}

function scanForSecrets(doc: Record<string, unknown>, issues: Issue[]): void {
  const hits: Array<{ path: string; pointer: string; label: string }> = [];

  const scanString = (
    value: string,
    path: string,
    pointer: string,
    key?: string,
  ): void => {
    const label = credentialKind(value, key);
    if (label !== undefined) hits.push({ path, pointer, label });
  };

  const walk = (
    value: unknown,
    path: string,
    pointer: string,
    key?: string,
  ): void => {
    if (typeof value === 'string') {
      scanString(value, path, pointer, key);
    } else if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        walk(item, `${path}[${i}]`, pointer + ptr(i));
      }
    } else if (isRecord(value)) {
      for (const [k, item] of Object.entries(value)) {
        walk(item, path === '' ? k : `${path}.${k}`, pointer + ptr(k), k);
      }
    }
  };
  walk(doc, '', '');

  for (const { path, pointer, label } of hits.slice(0, 5)) {
    issues.push(
      err(
        'SECRET_IN_DOCUMENT',
        `the document appears to contain a credential (${label})`,
        {
          path,
          hint: 'remove it — secrets are configured on the connector and injected at runtime, never stored in automations',
          // The label names the KIND of credential, never its value.
          at: { pointer },
          params: { kind: label },
        },
      ),
    );
  }
}
