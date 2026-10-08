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
import { ptr } from '../syntax/pointer';
import type { Issue } from '../types';
import { AUTOMATION_NAME_RULE, isValidAutomationName } from './name';
import { compileSchema, describeSchemaErrors } from './schema';

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

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API key (sk-…)'],
  [/\bAKIA[0-9A-Z]{12,}/, 'AWS access key'],
  [/\bxox[bap]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key material'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'bearer token'],
];

/** Key names that mark their value as a credential when it looks opaque. */
const CREDENTIAL_KEY_RE =
  /^(?:api[_-]?key|apikey|secret|token|access[_-]?key|password|passwd|authorization|auth[_-]?token)$/i;

/** A long single opaque word — no spaces, no template braces. */
const OPAQUE_VALUE_RE = /^[A-Za-z0-9+/=_.-]{16,}$/;

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
function inputCheck(inputs: unknown): ValidateFunction | null {
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
    if (check !== null) checkTestInput(i, t.name, t.input, check, issues);
    if (t.expect === undefined) continue;
    const keys = isRecord(t.expect) ? Object.keys(t.expect) : [];
    const bad = keys.filter((k) => k !== 'output' && k !== 'effects');
    if (!isRecord(t.expect) || bad.length > 0) {
      issues.push(
        err(
          'TESTS_INVALID',
          `tests[${i}].expect has unknown key(s): ${bad.join(', ') || JSON.stringify(t.expect)}`,
          {
            path: `tests[${i}].expect`,
            hint: 'expect supports {output?, effects?: [{connector, input?}]}',
            at: { pointer: ptr('tests', i, 'expect') },
            params: { test: i, keys: bad },
          },
        ),
      );
    }
  }
}

/**
 * A test's input against the inputs schema: a run checks its input before
 * any node runs, so an input the schema refuses fails the test before it
 * tests anything.
 */
function checkTestInput(
  index: number,
  name: string,
  input: unknown,
  check: ValidateFunction,
  issues: Issue[],
): void {
  if (check(input)) return;
  const errors = check.errors ?? [];
  const described = describeSchemaErrors(errors);
  const missing = described
    .filter((_, k) => errors[k]?.keyword === 'required')
    .map((d) => d.path);
  const problems = described.map((d) =>
    d.path === '' ? d.message : `${d.path} ${d.message}`,
  );
  issues.push(
    warn(
      'TESTS_INPUT_INVALID',
      `tests[${index}] "${name}": input does not match the inputs schema: ${problems.join('; ')}`,
      {
        hint: 'the run refuses this input before any node runs, so the test cannot pass',
        at: { pointer: ptr('tests', index, 'input') },
        params: { test: index, name, missing, problems },
      },
    ),
  );
}

function scanForSecrets(doc: Record<string, unknown>, issues: Issue[]): void {
  const hits: Array<{ path: string; pointer: string; label: string }> = [];

  const scanString = (
    value: string,
    path: string,
    pointer: string,
    key?: string,
  ): void => {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(value)) {
        hits.push({ path, pointer, label });
        return;
      }
    }
    if (
      key !== undefined &&
      CREDENTIAL_KEY_RE.test(key) &&
      OPAQUE_VALUE_RE.test(value)
    ) {
      hits.push({
        path,
        pointer,
        label: `credential-looking value under "${key}"`,
      });
    }
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
