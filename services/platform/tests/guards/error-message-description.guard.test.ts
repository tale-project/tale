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
 * `description={err.message}`, `description: err.message` (or `e.message`,
 * `ex.message`: the short catch names), `(err as Error).message` and
 * `String(err)`. A message that first passes through a variable is beyond a
 * text scan, which is what the two helpers are for. The platform's `test`
 * task hashes `packages/ui/src` for this read
 * (`services/platform/turbo.json`).
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const ROOTS = ['services/platform/app', 'packages/ui/src'];

/** The opening of a toast's or an Alert's text, as a property or a prop. */
const TEXT_PROP = String.raw`\b(?:description|title)\s*[:=]\s*\{?\s*`;
/** An identifier that names an error: `err`, `error`, `saveError`,
 * `statsError`, and the short catch names `e` and `ex`. */
const ERROR_NAME = String.raw`(?:e|ex|\w*[eE]rr\w*)\b`;

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

interface Violation {
  file: string;
  line: number;
  shape: string;
  /** The matched source, its whitespace collapsed to single spaces. */
  text: string;
}

interface Allowance {
  file: string;
  /** The matched text, whitespace collapsed, as {@link Violation} carries it. */
  text: string;
  /** How many sites of that text the file holds; one unless it says more. */
  count?: number;
  reason: string;
}

/**
 * Surfaces whose error is provably a plain `Error`, each keyed by its repo
 * path AND the text the shape matched, with the reason. An entry exempts
 * exactly the sites it counts, never the rest of its file: a file holding
 * another copy of the same line fails with every copy listed, and a file
 * holding fewer marks the entry stale.
 */
const ALLOWED: readonly Allowance[] = [];

/** The sites of `found` that `entry` names. */
function sitesOf(entry: Allowance, found: readonly Violation[]): Violation[] {
  return found.filter(
    (violation) =>
      violation.file === entry.file && violation.text === entry.text,
  );
}

/** The violations the allowlist does not exempt. */
function unexempted(
  found: readonly Violation[],
  allowances: readonly Allowance[] = ALLOWED,
): Violation[] {
  const exempt = new Set<Violation>();
  for (const entry of allowances) {
    const sites = sitesOf(entry, found);
    if (sites.length === (entry.count ?? 1)) {
      for (const site of sites) exempt.add(site);
    }
  }
  return found.filter((violation) => !exempt.has(violation));
}

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

/** Every forbidden shape in `src`. */
function violations(file: string, src: string): Violation[] {
  const found: Violation[] = [];
  for (const { name, pattern } of FORBIDDEN) {
    for (const match of src.matchAll(pattern)) {
      found.push({
        file,
        line: src.slice(0, match.index).split('\n').length,
        shape: name,
        text: match[0].replaceAll(/\s+/g, ' ').trim(),
      });
    }
  }
  return found;
}

function scan(): Violation[] {
  const found: Violation[] = [];
  for (const root of ROOTS) {
    for (const full of sourceFiles(path.join(REPO_ROOT, root))) {
      const file = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      found.push(...violations(file, readFileSync(full, 'utf8')));
    }
  }
  return found;
}

describe('error message guard', () => {
  it("builds no toast or Alert text from an error's message", () => {
    const shown = unexempted(scan()).map(
      ({ file, line, shape, text }) => `${file}:${line}: ${shape} (${text})`,
    );
    expect(
      shown,
      'read the failure through failureDetail (platform) or readableErrorMessage (@tale/ui)',
    ).toEqual([]);
  });

  it('keeps no stale allowlist entry', () => {
    const found = scan();
    expect(
      ALLOWED.filter(
        (entry) => sitesOf(entry, found).length < (entry.count ?? 1),
      ),
    ).toEqual([]);
  });

  // An entry used to exempt its whole file, so a second offender written
  // into an allowed file passed. It names one site now.
  it('exempts only the allowed site, not the rest of its file', () => {
    const src = [
      "toast({ title: t('x'), description: err.message });",
      "toast({ title: t('y'), description:\n  e.message });",
    ].join('\n');
    const allowance = {
      file: 'sample.tsx',
      text: 'description: err.message',
      reason: 'a sample',
    };
    expect(
      unexempted(violations('sample.tsx', src), [allowance]).map(
        ({ line, text }) => ({ line, text }),
      ),
    ).toEqual([{ line: 2, text: 'description: e.message' }]);
  });

  // Keyed by its text, an entry also exempted every identical copy of its
  // line in the file: a second `description: err.message` passed with it.
  it('exempts only as many identical sites as the entry counts', () => {
    const src = [
      "toast({ title: t('x'), description: err.message });",
      "toast({ title: t('y'), description: err.message });",
    ].join('\n');
    const allowance = {
      file: 'sample.tsx',
      text: 'description: err.message',
      reason: 'a sample',
    };
    const lines = (allowances: readonly Allowance[]) =>
      unexempted(violations('sample.tsx', src), allowances).map(
        ({ line }) => line,
      );
    expect(lines([allowance])).toEqual([1, 2]);
    expect(lines([{ ...allowance, count: 2 }])).toEqual([]);
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
    // The short catch names (`catch (e)`, `catch (ex)`).
    "toast({ title: t('saveError'), description: e.message });",
    '<Alert description={e.message} />',
    'title: ex?.message,',
    'description: String(e),',
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
    // An identifier that only starts like a catch name is not one.
    "description: entry.message ?? t('x'),",
  ])('allows %j', (sample) => {
    expect(violations('sample.tsx', sample)).toEqual([]);
  });
});
