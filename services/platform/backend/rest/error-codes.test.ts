// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SKILL_BUNDLE_REFUSAL_CODES } from '../core/skills/bundle_zip.ts';
import { SKILL_ERROR_STATUS } from '../domains/skills/errors.ts';
import { REST_ERROR_CODES, isRestErrorCode } from './error-codes.ts';

const here = new URL('.', import.meta.url).pathname;

/** The door's handler sources — never its tests or its real-Postgres
 * check scripts, which carry codes of their own to compare against. */
function handlerSources(): string[] {
  return readdirSync(here)
    .filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('-check.ts'),
    )
    .map((name) => readFileSync(join(here, name), 'utf8'));
}

/** Every code literal a handler answers: `code: 'X'` in an envelope, the
 * third argument of `notFound(c, …, 'X')`, the code of a
 * `RestRefusal(…, 'X')` or `invalidQueryResponse(c, 'X', …)`. */
function literalCodes(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)) {
    found.add(match[1] ?? '');
  }
  for (const match of source.matchAll(
    /(?:notFound|invalidQueryResponse|new RestRefusal)\(([^;]*?)\)/gs,
  )) {
    for (const code of (match[1] ?? '').matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) {
      found.add(code[1] ?? '');
    }
  }
  found.delete('');
  return [...found];
}

describe('the REST error-code registry', () => {
  it('is sorted and free of duplicates', () => {
    const sorted = [...REST_ERROR_CODES].sort();
    expect([...REST_ERROR_CODES]).toEqual(sorted);
    expect(new Set(REST_ERROR_CODES).size).toBe(REST_ERROR_CODES.length);
  });

  it('carries every code the door’s handlers answer', () => {
    const unregistered = handlerSources()
      .flatMap(literalCodes)
      .filter((code) => !isRestErrorCode(code));
    expect([...new Set(unregistered)].sort()).toEqual([]);
  });

  it('carries every code the skills family maps onto a status', () => {
    // The bundle-upload refusals are the app's zip lane; REST takes the
    // skill body as text and never reaches them.
    const bundleOnly: ReadonlySet<string> = new Set(SKILL_BUNDLE_REFUSAL_CODES);
    const unregistered = Object.keys(SKILL_ERROR_STATUS).filter(
      (code) => !isRestErrorCode(code) && !bundleOnly.has(code),
    );
    expect(unregistered).toEqual([]);
  });

  it('carries every code the OpenAPI source names', () => {
    const spec = readFileSync(
      join(here, '..', '..', 'scripts', 'openapi', 'spec.ts'),
      'utf8',
    );
    // Backticked SHOUTING identifiers in descriptions are codes — bar the
    // one environment variable a description names.
    const named = new Set(
      [...spec.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)]
        .map((match) => match[1] ?? '')
        .filter((code) => code !== 'TALE_DEPLOYMENT_CONFIG_ADMINS'),
    );
    const unregistered = [...named].filter((code) => !isRestErrorCode(code));
    expect(unregistered.sort()).toEqual([]);
  });
});
