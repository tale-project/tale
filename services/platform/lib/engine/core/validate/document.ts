/**
 * Document-level validation: top-level shape, versioning, name, the inputs
 * schema, the tests block, and the credential scan.
 *
 * Secrets never live in documents — they are configured on integrations and
 * injected into live() calls at runtime — so any credential-looking string
 * is an error. The scan is deliberately conservative: well-known token
 * shapes, bearer headers, and opaque values under credential-named keys.
 * Ordinary prose never matches.
 */

import { isRecord } from '../../../utils/type-utils';
import { err, warn } from '../errors';
import type { Issue } from '../types';
import { compileSchema } from './schema';

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

/** Automation names are kebab-case — the store identity and the subautomation
 * `automation` reference syntax both build on this shape. */
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
        }),
      );
    }
  }

  if (doc.version === undefined) {
    issues.push(
      warn('VERSION_MISSING', 'document has no "version" field', {
        path: 'version',
        hint: 'add version: 1',
      }),
    );
  } else if (doc.version !== 1) {
    issues.push(
      err(
        'VERSION_UNSUPPORTED',
        `unsupported document version ${JSON.stringify(doc.version)} — this engine supports version 1`,
        { path: 'version' },
      ),
    );
  }

  if (typeof doc.name !== 'string' || !NAME_RE.test(doc.name)) {
    issues.push(
      err(
        'NAME_INVALID',
        '"name" is required and must be kebab-case (e.g. "weather-report")',
        { path: 'name' },
      ),
    );
  }

  if (doc.inputs !== undefined) {
    if (!isRecord(doc.inputs)) {
      issues.push(
        err('INPUTS_SCHEMA_INVALID', '"inputs" must be a JSON Schema object', {
          path: 'inputs',
        }),
      );
    } else {
      try {
        compileSchema(doc.inputs);
      } catch (e) {
        issues.push(
          err(
            'INPUTS_SCHEMA_INVALID',
            `"inputs" is not a valid JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
            { path: 'inputs' },
          ),
        );
      }
    }
  }

  if (doc.tests !== undefined) validateTests(doc.tests, issues);

  scanForSecrets(doc, issues);
}

function validateTests(tests: unknown, issues: Issue[]): void {
  if (!Array.isArray(tests)) {
    issues.push(
      err(
        'TESTS_INVALID',
        '"tests" must be an array of {name, input, expect?}',
        {
          path: 'tests',
        },
      ),
    );
    return;
  }
  for (const [i, t] of tests.entries()) {
    if (!isRecord(t) || typeof t.name !== 'string' || !('input' in t)) {
      issues.push(
        err(
          'TESTS_INVALID',
          `tests[${i}] must be {name: string, input, expect?}`,
          {
            path: `tests[${i}]`,
          },
        ),
      );
      continue;
    }
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
            hint: 'expect supports {output?, effects?: [{integration, input?}]}',
          },
        ),
      );
    }
  }
}

function scanForSecrets(doc: Record<string, unknown>, issues: Issue[]): void {
  const hits: Array<{ path: string; label: string }> = [];

  const scanString = (value: string, path: string, key?: string): void => {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(value)) {
        hits.push({ path, label });
        return;
      }
    }
    if (
      key !== undefined &&
      CREDENTIAL_KEY_RE.test(key) &&
      OPAQUE_VALUE_RE.test(value)
    ) {
      hits.push({ path, label: `credential-looking value under "${key}"` });
    }
  };

  const walk = (value: unknown, path: string, key?: string): void => {
    if (typeof value === 'string') {
      scanString(value, path, key);
    } else if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) walk(item, `${path}[${i}]`);
    } else if (isRecord(value)) {
      for (const [k, item] of Object.entries(value)) {
        walk(item, path === '' ? k : `${path}.${k}`, k);
      }
    }
  };
  walk(doc, '');

  for (const { path, label } of hits.slice(0, 5)) {
    issues.push(
      err(
        'SECRET_IN_DOCUMENT',
        `the document appears to contain a credential (${label})`,
        {
          path,
          hint: 'remove it — secrets are configured on the integration and injected at runtime, never stored in automations',
        },
      ),
    );
  }
}
