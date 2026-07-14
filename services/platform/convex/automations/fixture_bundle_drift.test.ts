/**
 * Lockstep guard for the pinned automation-bundle copies in the test fixtures.
 *
 * Two fixture trees carry copies of builtin automation bundles, and each copy must
 * track its source byte-for-byte (the install path copies bundle files
 * verbatim, so a drifted fixture asserts a UI that no org can ever see):
 *
 * A slug is a PATH (`github/create-pull-requests`), so a "copy" is the whole
 * nested dir at that path — group dirs (`github/`) carry no bundle of their own.
 *
 * - `tests/e2e/fixtures/config/qa-guides-org/automations/` — the manual-QA org's
 *   config. It carries the "Resolve GitHub issues" bundle's visible manifest
 *   plus its four hidden member automations (`github/triage-issues`,
 *   `github/sync-issues`, `github/create-pull-requests`,
 *   `github/review-pull-requests`), the three email inbox automations
 *   (`outlook/sync-emails`, `gmail/sync-emails`, `imap-smtp/sync-emails`) — all as
 *   BYTE-IDENTICAL copies of `builtin-configs/automations/<slug>/` — and
 *   `github/create-pull-requests-qa`: the private-upload variant the manual
 *   guide's F14 case uses (the same bundle under a renamed LEAF;
 *   `github/create-pull-requests` is picked over the other members because it
 *   carries BOTH an agent and a workflow, exercising every reference kind the
 *   transform must rewrite — the bundle manifest itself carries neither, so
 *   renaming IT alone would exercise nothing). The documented transform (and
 *   nothing else): every `github/create-pull-requests/` becomes
 *   `github/create-pull-requests-qa/` — in JSON file CONTENTS (the inline
 *   workflow's slug references, composite agent slugs like
 *   `github/create-pull-requests/pr-creator`, view workflow refs). Bare
 *   occurrences without the slash (`metadata.pack`) are NOT part of the transform.
 * - `tests/e2e/fixtures/config/default/automations/` — the hermetic e2e stack's
 *   builtin catalog (`playwright.config.ts` pins `TALE_CONFIG_BUILTIN_DIR`
 *   here). Worker orgs scaffold their automation catalog from it, and
 *   `automations.spec.ts` / `email-automation.spec.ts` assert against these bundles — the
 *   same eight builtin bundles, BYTE-IDENTICAL.
 *
 * A refresh of a builtin bundle must re-sync every fixture copy; this test is
 * what fails when someone forgets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const BUILTIN_AUTOMATIONS_DIR = fileURLToPath(
  new URL('../../../../builtin-configs/automations/', import.meta.url),
);
const QA_FIXTURE_AUTOMATIONS_DIR = fileURLToPath(
  new URL(
    '../../tests/e2e/fixtures/config/qa-guides-org/automations/',
    import.meta.url,
  ),
);
const E2E_FIXTURE_AUTOMATIONS_DIR = fileURLToPath(
  new URL(
    '../../tests/e2e/fixtures/config/default/automations/',
    import.meta.url,
  ),
);

/** Builtin bundles with a pinned byte-identical copy in a fixture tree. */
const MIRRORED_SLUGS = [
  'github/resolve-issues',
  'github/triage-issues',
  'github/sync-issues',
  'github/create-pull-requests',
  'github/review-pull-requests',
  'outlook/sync-emails',
  'gmail/sync-emails',
  'imap-smtp/sync-emails',
] as const;

/** Every file under `dir`, as sorted POSIX-relative paths. */
function listFilesRecursive(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(abs).isDirectory()) {
      out.push(...listFilesRecursive(abs, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** The documented slug transform (see the file header). */
function toQaSlug(value: string): string {
  return value.replaceAll(
    'github/create-pull-requests/',
    'github/create-pull-requests-qa/',
  );
}

/**
 * Pins `fixtureDir` as a byte-identical mirror of the builtin bundle `slug`
 * (same file set, same bytes — no transform).
 */
function describeMirror(slug: string, fixtureAutomationsDir: string): void {
  const builtinDir = join(BUILTIN_AUTOMATIONS_DIR, slug);
  const fixtureDir = join(fixtureAutomationsDir, slug);
  const files = listFilesRecursive(builtinDir);

  it('carries exactly the builtin file set', () => {
    expect(files.length).toBeGreaterThan(0);
    // A bundle ships `bundle.json`; an ordinary automation ships `automation.json`.
    expect(
      files.includes('automation.json') || files.includes('bundle.json'),
      `${slug} manifest file`,
    ).toBe(true);
    expect(listFilesRecursive(fixtureDir)).toEqual(files);
  });

  it('every file is byte-identical to the builtin', () => {
    for (const rel of files) {
      const builtin = readFileSync(join(builtinDir, rel));
      const fixture = readFileSync(join(fixtureDir, rel));
      expect(fixture.equals(builtin), rel).toBe(true);
    }
  });
}

// The guard must never silently pass because a directory moved.
it('locates the builtin bundles and both fixture trees', () => {
  for (const slug of MIRRORED_SLUGS) {
    expect(existsSync(join(BUILTIN_AUTOMATIONS_DIR, slug)), slug).toBe(true);
    expect(existsSync(join(QA_FIXTURE_AUTOMATIONS_DIR, slug)), slug).toBe(true);
    expect(existsSync(join(E2E_FIXTURE_AUTOMATIONS_DIR, slug)), slug).toBe(
      true,
    );
  }
  expect(
    existsSync(
      join(QA_FIXTURE_AUTOMATIONS_DIR, 'github/create-pull-requests-qa'),
    ),
  ).toBe(true);
});

for (const slug of MIRRORED_SLUGS) {
  describe(`qa-guides-org fixture "${slug}" mirrors the builtin bundle`, () => {
    describeMirror(slug, QA_FIXTURE_AUTOMATIONS_DIR);
  });
  describe(`e2e default fixture "${slug}" mirrors the builtin bundle`, () => {
    describeMirror(slug, E2E_FIXTURE_AUTOMATIONS_DIR);
  });
}

describe('qa-guides-org fixture "github/create-pull-requests-qa" is the slug-renamed builtin', () => {
  const builtinDir = join(
    BUILTIN_AUTOMATIONS_DIR,
    'github/create-pull-requests',
  );
  const fixtureDir = join(
    QA_FIXTURE_AUTOMATIONS_DIR,
    'github/create-pull-requests-qa',
  );
  const builtinFiles = listFilesRecursive(builtinDir);

  it('carries the builtin file set under the transformed workflow paths', () => {
    expect(listFilesRecursive(fixtureDir)).toEqual(
      builtinFiles.map(toQaSlug).sort(),
    );
  });

  it('every JSON file equals the builtin content under the slug transform', () => {
    for (const rel of builtinFiles) {
      const fixturePath = join(fixtureDir, toQaSlug(rel));
      const fixture = readFileSync(fixturePath, 'utf8');
      const builtin = readFileSync(join(builtinDir, rel), 'utf8');
      const expected = rel.endsWith('.json') ? toQaSlug(builtin) : builtin;
      expect(fixture, rel).toBe(expected);
    }
  });

  it('no un-renamed workflow/agent reference survives the transform', () => {
    for (const rel of listFilesRecursive(fixtureDir)) {
      if (!rel.endsWith('.json')) continue;
      const text = readFileSync(join(fixtureDir, rel), 'utf8');
      // `github/create-pull-requests-qa/` contains `github/create-pull-requests`
      // — assert on the slash-scoped form the transform targets, tolerating the
      // renamed slug itself.
      expect(
        text.replaceAll('github/create-pull-requests-qa/', ''),
        rel,
      ).not.toContain('github/create-pull-requests/');
    }
  });
});
