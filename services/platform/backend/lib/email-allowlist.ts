/**
 * An operator's email allowlist, as the deployment environment states it:
 * one variable, addresses separated by commas, semicolons or whitespace,
 * matched case-insensitively. `TALE_DEPLOYMENT_CONFIG_ADMINS` (who may write
 * the deployment config file) and `TALE_ORGANIZATION_CREATORS` (who may
 * create an organization) are the two lists; both read through here so the
 * grammar cannot drift between them.
 *
 * Pure string parsing — no environment access, no database — so the gates
 * built on it unit-test with a value, not a process.
 */

/** Parse a list value into lower-cased, trimmed addresses; stray separators
 * and blank fragments are dropped. An empty value is an empty set. */
export function parseEmailAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/** True iff `email` is on the list, compared trimmed and lower-cased. A
 * missing or blank email is never on any list. */
export function isEmailAllowlisted(
  allowlist: ReadonlySet<string>,
  email: string | undefined,
): boolean {
  if (email === undefined) return false;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && allowlist.has(normalized);
}
