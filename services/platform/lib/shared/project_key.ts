/**
 * Project key: the short, immutable prefix for human-readable task identifiers
 * (Linear/Jira style — e.g. `TAL-1`, `TAL-2`). Derived from the project name at
 * creation, optionally overridden by the user, and fixed thereafter.
 *
 * Pure helpers shared by the Convex create mutation (validation) and the
 * create-project dialog (live derivation as the user types the name).
 */

const PROJECT_KEY_MIN = 2;
export const PROJECT_KEY_MAX = 6;

/** Allowed shape: starts with a letter, then 1–5 more letters/digits, uppercase. */
const PROJECT_KEY_REGEX = new RegExp(
  `^[A-Z][A-Z0-9]{${PROJECT_KEY_MIN - 1},${PROJECT_KEY_MAX - 1}}$`,
);

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_REGEX.test(key);
}

/**
 * Normalize raw user input toward a valid key: uppercase, strip everything but
 * letters/digits, drop leading digits (a key must start with a letter), and cap
 * at {@link PROJECT_KEY_MAX}. May return a too-short string — callers validate.
 */
export function normalizeProjectKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, PROJECT_KEY_MAX);
}

/**
 * Suggest a key from a project name: initials of the first words when the name
 * is multi-word, otherwise the leading letters of the single word. Always
 * returns a normalized (possibly empty) string — e.g. "Tale Platform" → "TAL",
 * "tale" → "TAL", "QA" → "QA".
 */
export function deriveProjectKey(name: string): string {
  const words = name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const candidate =
    words.length >= 2
      ? words
          .slice(0, 3)
          .map((w) => w[0])
          .join('')
      : words[0].slice(0, 3);
  return normalizeProjectKey(candidate);
}

/** Render a task identifier, or `null` when the project has no key yet. */
export function formatTaskIdentifier(
  key: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (!key || number == null) return null;
  return `${key}-${number}`;
}
