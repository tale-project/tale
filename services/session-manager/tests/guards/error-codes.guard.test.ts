// The page words an error from its code (`errors.<code>` in the catalog). A
// code the backend answers with and the catalog lacks shows the backend's
// English sentence in a German page; a sentence whose code the backend never
// uses is dead text in three languages. This guard reads the backend's own
// source for its codes, so a new code cannot be forgotten.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRecord } from '../../lib/is-record.ts';
import errors from '../../messages/en/errors.yml';

const BACKEND = resolve(import.meta.dirname, '../../backend');

/**
 * The page's own sentences: not a code of the backend. `server_error` and
 * `bad_answer` are made up by the page for an answer that is no error of the
 * backend's (`app/lib/api/client.ts`); `fallback` is for any code it has no
 * words for.
 */
const OF_THE_PAGE = new Set([
  'fallback',
  'network',
  'server_error',
  'bad_answer',
]);

/**
 * The sentences a code has besides its own, `<code>_<what>`: for when the
 * answer says why in its extra fields (`app/lib/api/failure.ts` picks the one
 * that fits). The plain sentence stays for when it does not (older data, AI
 * clients). The backend names the fields in `refusals.ts`.
 */
const VARIANTS: Readonly<Record<string, readonly string[]>> = {
  browser_error: ['browser_error_reason'],
  no_working_proxy: ['no_working_proxy_failed'],
  proxy_unreachable: ['proxy_unreachable_reason'],
  session_busy: [
    'session_busy_assigning_proxy',
    'session_busy_starting',
    'session_busy_stopping',
  ],
  unknown_ip_location: ['unknown_ip_location_reason'],
};

/**
 * Answered, but never to a call the page makes: an unknown API address, and the
 * refusals of the MCP endpoint, which only AI clients call.
 */
const NEVER_SHOWN = new Set([
  'not_found',
  'ai_access_off',
  'method_not_allowed',
  'unsupported_media_type',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : sourceFiles(path);
    }
    const isSource =
      entry.name.endsWith('.ts') && !entry.name.includes('.test.');
    return isSource ? [path] : [];
  });
}

/**
 * Every code an `AppError` (an answer) or a `StartError` (a session's error) is
 * made with, and the two the request checks answer with (`security.ts` names
 * them in a union type).
 */
function codesOfTheBackend(): Set<string> {
  const codes = new Set<string>();
  const construction =
    /new (?:AppError\(\s*\d{3}|StartError\()\s*,?\s*'([a-z_]+)'/g;
  for (const file of sourceFiles(BACKEND)) {
    for (const match of readFileSync(file, 'utf8').matchAll(construction)) {
      const code = match[1];
      if (code !== undefined) codes.add(code);
    }
  }
  // The answer of an unexpected failure is a literal, not an `AppError`.
  const literal = /\berror: '([a-z_]+)',\s*message:/g;
  for (const file of sourceFiles(BACKEND)) {
    for (const match of readFileSync(file, 'utf8').matchAll(literal)) {
      const code = match[1];
      if (code !== undefined) codes.add(code);
    }
  }
  const security = readFileSync(join(BACKEND, 'security.ts'), 'utf8');
  for (const match of security.matchAll(/'(forbidden_[a-z]+)'/g)) {
    const code = match[1];
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

function sentencesOfThePage(): Set<string> {
  if (!isRecord(errors)) throw new Error('errors.yml is not a map');
  return new Set(Object.keys(errors));
}

describe('the error codes of the backend and the sentences of the page', () => {
  it('finds the codes of the backend in its source', () => {
    // A scan that finds nothing would pass the checks below for nothing.
    const codes = codesOfTheBackend();
    expect(codes.size).toBeGreaterThan(20);
    expect(codes).toContain('no_free_proxy');
    expect(codes).toContain('no_working_proxy');
  });

  it('words every code a person can meet', () => {
    const sentences = sentencesOfThePage();
    const missing = [...codesOfTheBackend()].filter(
      (code) => !sentences.has(code) && !NEVER_SHOWN.has(code),
    );
    expect(missing).toEqual([]);
  });

  it('keeps no sentence for a code the backend does not use', () => {
    const codes = codesOfTheBackend();
    const variants = new Set(Object.values(VARIANTS).flat());
    const dead = [...sentencesOfThePage()].filter(
      (code) =>
        !codes.has(code) && !OF_THE_PAGE.has(code) && !variants.has(code),
    );
    expect(dead).toEqual([]);
  });

  it('has every sentence a code is worded with when the answer says why', () => {
    const sentences = sentencesOfThePage();
    const missing = Object.values(VARIANTS)
      .flat()
      .filter((variant) => !sentences.has(variant));
    expect(missing).toEqual([]);
  });

  it('words a code with another sentence only for a code the backend uses', () => {
    const codes = codesOfTheBackend();
    for (const [code, variants] of Object.entries(VARIANTS)) {
      expect(codes, `${code} is no code of the backend`).toContain(code);
      for (const variant of variants) {
        expect(variant.startsWith(`${code}_`), variant).toBe(true);
        // A variant needs the fields of its code: shown as a code of its own it
        // would print its placeholders.
        expect(codes, `${variant} is a code of the backend`).not.toContain(
          variant,
        );
      }
    }
  });
});
