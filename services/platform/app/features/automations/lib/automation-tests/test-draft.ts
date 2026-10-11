/**
 * The draft's tests, changed one at a time on the raw document
 * (`../draft-document`): each test keeps every key it holds, the ones this
 * build has no control for too, so a test changed here saves as written.
 * The list stays in the document's order — a test's place is what its
 * problems' pointers (`/tests/2/input`) and its results name.
 */

import type { RawDocument } from '../draft-document';
import { missingRequiredFields, placeholderFor } from '../fixed-input';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The document's tests as written: whatever its `tests` list holds. */
export function testsOf(raw: RawDocument | null): readonly unknown[] {
  const tests = raw?.tests;
  return Array.isArray(tests) ? tests : [];
}

/** A test's own name, when it has one to show. */
export function testNameOf(test: unknown): string | undefined {
  if (!isRecord(test)) return undefined;
  const { name } = test;
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

/** The document with `tests` as its list; without the key once it is
 * empty, as a document without tests is written. */
function withTests(raw: RawDocument, tests: readonly unknown[]): RawDocument {
  if (tests.length > 0) return { ...raw, tests: [...tests] };
  const next: Record<string, unknown> = { ...raw };
  delete next.tests;
  return next;
}

/**
 * A name no test of the document has: `base` itself, else `base 2`,
 * `base 3`, … — so two tests never read alike in a list of results.
 */
export function unusedTestName(raw: RawDocument, base: string): string {
  const taken = new Set(
    testsOf(raw).flatMap((test) => {
      const name = testNameOf(test);
      return name === undefined ? [] : [name];
    }),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * A test to start from: its input holds a placeholder for each field the
 * run input's schema requires (`""`, `0`, `false`, `[]`, `{}`), and it
 * expects nothing yet beyond a run that does not fail.
 */
export function blankTest(
  raw: RawDocument,
  name: string,
): Record<string, unknown> {
  const schema = isRecord(raw.inputs) ? raw.inputs : undefined;
  const input = Object.fromEntries(
    missingRequiredFields(schema, {}).map((field) => [
      field.name,
      placeholderFor(field.type),
    ]),
  );
  return { name, input, expect: {} };
}

/** The document with `test` after its last test, and the new test's place. */
export function addTest(
  raw: RawDocument,
  test: unknown,
): { document: RawDocument; index: number } {
  const tests = testsOf(raw);
  return { document: withTests(raw, [...tests, test]), index: tests.length };
}

/** The document with the test at `index` replaced by `test`, as given. The
 * same document when there is no test there. */
export function replaceTest(
  raw: RawDocument,
  index: number,
  test: unknown,
): RawDocument {
  const tests = testsOf(raw);
  if (index < 0 || index >= tests.length) return raw;
  const next = [...tests];
  next[index] = test;
  return withTests(raw, next);
}

/** The document without the test at `index`. */
export function removeTest(raw: RawDocument, index: number): RawDocument {
  const tests = testsOf(raw);
  if (index < 0 || index >= tests.length) return raw;
  return withTests(
    raw,
    tests.filter((_, at) => at !== index),
  );
}

/**
 * The document with a copy of the test at `index` right after it, named
 * `name`; every other key of the copy as the original holds it. Null when
 * there is no test there to copy.
 */
export function duplicateTest(
  raw: RawDocument,
  index: number,
  name: string,
): { document: RawDocument; index: number } | null {
  const tests = testsOf(raw);
  const original = tests[index];
  if (index < 0 || index >= tests.length || original === undefined) {
    return null;
  }
  const copy: unknown = isRecord(original)
    ? { ...structuredClone(original), name }
    : structuredClone(original);
  const next = [...tests];
  next.splice(index + 1, 0, copy);
  return { document: withTests(raw, next), index: index + 1 };
}
