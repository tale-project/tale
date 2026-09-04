import type { Sql } from 'postgres';

/**
 * The per-(org, slug) writer mutex every skill write holds — the 0.4
 * claim-slot table collapsed into one pg advisory xact lock.
 *
 * The bundle swap in `writeSkillBundleFiles` is atomic only while writers to
 * one slug are serialized: a save landing between its aside-rename and its
 * commit-rename recreates the bundle directory, so the commit fails, the
 * rollback fails too, and the previous bundle is stranded invisible in a
 * `.replacing-*` sibling while the visible one holds just the editor's
 * SKILL.md. The upload lane always took this lock; the editor's save and
 * delete — the app route and the REST family alike — take the SAME one, so
 * no door can slip between another's two renames.
 *
 * The lock lives for the transaction, which is open only for `work`: the
 * filesystem write happens inside it and the lock releases on commit or
 * rollback either way. Every api replica shares the database, which is what
 * makes this serialize across replicas where an in-process mutex could not.
 */
export function skillWriterLockKey(
  organizationId: string,
  slug: string,
): string {
  return `skill:${organizationId}:${slug}`;
}

export async function withSkillWriterLock<T>(
  sql: Sql,
  organizationId: string,
  slug: string,
  work: () => Promise<T>,
): Promise<T> {
  // Assigned inside the callback: postgres.js types `begin`'s result through
  // an array-unwrapping conditional a generic `T` cannot collapse.
  let result!: T;
  await sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtext(${skillWriterLockKey(organizationId, slug)})
      )
    `;
    result = await work();
  });
  return result;
}
