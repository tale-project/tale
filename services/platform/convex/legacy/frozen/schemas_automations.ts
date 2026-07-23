/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of the retired `lib/shared/schemas/automations.ts` (part of
 * the ripped-domain Zod schemas). The original file also declared
 * `automationManifestSchema` / `bundleManifestSchema` (full manifest-shape
 * validation) and several path/param helpers; NONE of those are needed here —
 * only the automation-slug validator + the two bundle-marker filenames +
 * the depth cap, which is everything
 * `v0_3_4/33_workflows_become_automations/migration.ts`,
 * `legacy/frozen/automations_file_utils.ts`, and
 * `legacy/frozen/config_domains.ts` import. Fully self-contained (the
 * original module needed no external deps for these symbols).
 */

/**
 * Automation slug — a '/'-separated PATH of kebab segments (`gmail/sync-emails`,
 * `projects/tasks/run-assigned`). The slug IS the automation's location: its dir
 * under the built-in catalog, its dir in an org tree. Each segment uses the
 * same alphabet as skills/workflows; underscores are excluded on purpose, so `__`
 * can never occur inside a slug and stays free as the URL separator.
 */
const AUTOMATION_SLUG_SEGMENT = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`;
const AUTOMATION_SLUG_REGEX = new RegExp(
  `^${AUTOMATION_SLUG_SEGMENT}(?:/${AUTOMATION_SLUG_SEGMENT})*$`,
);

/**
 * Depth cap on an automation slug — and therefore the recursion bound of every
 * walker that discovers automations on disk (`listAutomationSlugs`). One constant
 * so a path the validator accepts can never be a path the walker refuses to reach.
 */
export const MAX_AUTOMATION_SLUG_DEPTH = 4;
const MAX_AUTOMATION_SLUG_LENGTH = 128;

export function isValidAutomationSlug(slug: string): boolean {
  return (
    AUTOMATION_SLUG_REGEX.test(slug) &&
    slug.length <= MAX_AUTOMATION_SLUG_LENGTH &&
    slug.split('/').length <= MAX_AUTOMATION_SLUG_DEPTH
  );
}

/** The manifest file at the root of an automation bundle (its dir name is the slug). */
export const AUTOMATION_MANIFEST_FILENAME = 'automation.json';

/**
 * The manifest file at the root of a BUNDLE dir (its dir name is the slug) —
 * present INSTEAD of {@link AUTOMATION_MANIFEST_FILENAME}.
 */
export const BUNDLE_MANIFEST_FILENAME = 'bundle.json';
