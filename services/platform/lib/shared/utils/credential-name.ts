/**
 * The name a NEW credential gets among the names its (organization, vendor)
 * siblings already hold: `base` itself when free, else `base 2`, `base 3`, …
 * — the first number no sibling holds. ONE rule for every place that names a
 * credential on the operator's behalf — the add dialog's suggested name and
 * an OAuth grant's stored label — so the two never number differently.
 *
 * Compared trimmed and case-insensitively, the way the connector table's
 * unique index compares; that is stricter than the provider table's exact
 * constraint, so the answer is a name both tables accept. Layer A — no
 * imports.
 */
export function uniqueCredentialName(
  taken: readonly string[],
  base: string,
): string {
  const held = new Set(taken.map((name) => name.trim().toLowerCase()));
  let candidate = base;
  let counter = 1;
  while (held.has(candidate.trim().toLowerCase())) {
    counter += 1;
    candidate = `${base} ${counter}`;
  }
  return candidate;
}
