// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A surface never shows an error's own `message`. A structured error keeps
 * its payload on `data` and serializes it into `message`, for logs, so a
 * toast or an Alert whose text was built from it showed
 * `{"code":"UNAUTHORIZED",…}`. The platform reads a failure through
 * `failureDetail` (`app/lib/backend/adapters.ts`), and the design system
 * through `readableErrorMessage` (`@tale/ui/error-message`).
 *
 * This walks every non-test `.ts` and `.tsx` under `services/platform/app`
 * and `packages/ui/src`. It fails on a `description` or `title` that reads
 * `.message` straight off an error, in the shapes the offenders took: the
 * `x instanceof Error ? x.message` ternary on one line or across several,
 * `description={err.message}`, `description: err.message`,
 * `(err as Error).message` and `String(err)`. A message that first passes
 * through a variable is beyond a text scan, which is what the two helpers
 * are for. The platform's `test` task hashes `packages/ui/src` for this read
 * (`services/platform/turbo.json`).
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const ROOTS = ['services/platform/app', 'packages/ui/src'];

/** The opening of a toast's or an Alert's text, as a property or a prop. */
const TEXT_PROP = String.raw`\b(?:description|title)\s*[:=]\s*\{?\s*`;
/** An identifier that names an error: `err`, `error`, `saveError`, `statsError`. */
const ERROR_NAME = String.raw`\w*[eE]rr\w*`;

const FORBIDDEN = [
  {
    name: 'an `instanceof Error` ternary that reads `.message`',
    pattern: new RegExp(
      TEXT_PROP +
        String.raw`\(?\s*\w+\s+instanceof\s+\w*Error\s*\)?\s*\?\s*\(?\s*\w+\??\.message\b`,
      'g',
    ),
  },
  {
    name: "an error's `.message`",
    pattern: new RegExp(
      TEXT_PROP + ERROR_NAME + String.raw`\??\.message\b`,
      'g',
    ),
  },
  {
    name: 'an `(x as Error).message` cast',
    pattern: new RegExp(
      TEXT_PROP + String.raw`\(\s*\w+\s+as\s+\w*Error\s*\)\??\.message\b`,
      'g',
    ),
  },
  {
    name: 'a stringified error',
    pattern: new RegExp(
      TEXT_PROP + String.raw`String\(\s*` + ERROR_NAME + String.raw`\s*\)`,
      'g',
    ),
  },
];

/**
 * Surfaces whose error is provably a plain `Error`, keyed by repo path, each
 * with the reason. Every entry must still match a shape, or it is stale.
 */
const ALLOWED = new Map<string, string>();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.includes('.test.')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** `file:line: shape` for every forbidden shape in `src`. */
function violations(file: string, src: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of FORBIDDEN) {
    for (const match of src.matchAll(pattern)) {
      const line = src.slice(0, match.index).split('\n').length;
      found.push(`${file}:${line}: ${name}`);
    }
  }
  return found;
}

function scan(): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const full of sourceFiles(path.join(REPO_ROOT, root))) {
      const file = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      const found = violations(file, readFileSync(full, 'utf8'));
      if (found.length > 0) byFile.set(file, found);
    }
  }
  return byFile;
}

describe('error message guard', () => {
  it("builds no toast or Alert text from an error's message", () => {
    const shown = [...scan()]
      .filter(([file]) => !ALLOWED.has(file))
      .flatMap(([, found]) => found);
    expect(
      shown,
      'read the failure through failureDetail (platform) or readableErrorMessage (@tale/ui)',
    ).toEqual([]);
  });

  it('keeps no stale allowlist entry', () => {
    const found = scan();
    expect([...ALLOWED.keys()].filter((file) => !found.has(file))).toEqual([]);
  });

  // The shapes are regular expressions over source text: hold each to a
  // sample of what it must catch, and to what must stay allowed.
  it.each([
    "toast({ title: t('saveError'), description: err instanceof Error ? err.message : String(err) });",
    'description:\n          err instanceof Error\n            ? err.message\n            : String(err),',
    '<Alert title={t("x")} description={error instanceof Error ? error.message : undefined} />',
    '<Alert description={statsError.message} />',
    'description: error?.message,',
    "title: (err as Error).message ?? t('x'),",
    'description: String(error),',
    'title:\n            err instanceof AppError ? err.message : t("x"),',
  ])('catches %j', (sample) => {
    expect(violations('sample.tsx', sample)).not.toEqual([]);
  });

  it.each([
    'description: failureDetail(err),',
    "description: failureDetail(error) ?? tCommon('errors.generic'),",
    "description: readableErrorMessage(err) ?? t('errors.somethingWentWrong'),",
    '<Alert description={failureDetail(statsError)} />',
    "title={entry.message ?? t('versions.noMessage')}",
    'errorMessage={formState.errors.name?.message}',
    'const subtitle = err.message;',
  ])('allows %j', (sample) => {
    expect(violations('sample.tsx', sample)).toEqual([]);
  });
});
