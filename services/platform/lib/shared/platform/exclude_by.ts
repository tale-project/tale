/**
 * Generic cross-reference filter — "subtract" rows that already exist in another
 * data source. A list block fetched from outside Convex (e.g. GitHub issues) has
 * no idea which of its rows were already materialized into a Convex table (e.g.
 * tasks bound to issues). This computes the join client-side: build the set of
 * keys present in the reference rows, then drop any source row whose key is in
 * that set.
 *
 * The two sides name their key differently on purpose: the reference rows hold
 * the key in a plain FIELD (`refField`), while a source row's key is a
 * `{field}` TEMPLATE (`rowKeyTemplate`) interpolated over the row — so the same
 * key can be reconstructed from row fields the way it was originally written
 * (e.g. a task's `externalId` "owner/repo#N" rebuilt from an issue's `number`).
 * Both sides go through the shared `interpolateTemplate`, so the strings match
 * byte-for-byte.
 */
import { interpolateTemplate } from '../utils/interpolate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The set of non-empty join keys present in the reference rows. */
export function buildExclusionSet(
  refRows: readonly unknown[],
  refField: string,
): Set<string> {
  const set = new Set<string>();
  for (const row of refRows) {
    if (!isRecord(row)) continue;
    const raw = row[refField];
    // Skip falsy keys: `String(undefined)` would seed the set with the literal
    // "undefined" and falsely exclude any row whose key resolves to that.
    if (raw === undefined || raw === null || raw === '') continue;
    set.add(String(raw));
  }
  return set;
}

/**
 * Return `rows` minus any whose `rowKeyTemplate` matches a key present in
 * `refRows[refField]`. The template is interpolated over the row MERGED WITH
 * `templateScope` (the app's per-install config, e.g. a configured `owner`/
 * `repo`); row fields win a name clash. This lets the join key embed both
 * configured values and per-row fields (e.g. `"{owner}/{repo}#{number}"`) so it
 * still matches the externalId the create path wrote from the same config. Empty
 * `refRows` ⇒ `rows` unchanged.
 */
export function excludeExisting<T extends Record<string, unknown>>(
  rows: readonly T[],
  refRows: readonly unknown[],
  refField: string,
  rowKeyTemplate: string,
  templateScope?: Record<string, unknown>,
): T[] {
  const set = buildExclusionSet(refRows, refField);
  if (set.size === 0) return [...rows];
  return rows.filter(
    (row) =>
      !set.has(
        interpolateTemplate(rowKeyTemplate, { ...templateScope, ...row }),
      ),
  );
}
