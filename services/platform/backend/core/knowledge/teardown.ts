import {
  getKnowledgePoolForOrg,
  invalidateOrgUrl,
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from './pool';

/**
 * Remove everything an organization owns in its knowledge corpus. The corpus
 * is keyed by `org_slug` (not the organization id), so this is the step that
 * must complete before the slug may be taken by a new organization — a new
 * tenant with the same slug would otherwise read the old tenant's documents.
 *
 * Runs on the org's OWN pool (`getKnowledgePoolForOrg`, which follows the
 * org's knowledge connection config while that config still exists — so the
 * caller removes the config tree only AFTER this returns). One transaction:
 * private documents (chunks cascade, and are deleted explicitly for a
 * database whose baseline predates the FK), the semantic cache, the org's
 * website memberships, and every website nobody else holds any more (the
 * set form of `deregisterDomain`). Idempotent — a retry purges nothing and
 * reports zeros.
 */
export interface CorpusPurge {
  documents: number;
  chunks: number;
  websiteMemberships: number;
  websites: number;
}

export async function purgeCorpusForOrg(orgSlug: string): Promise<CorpusPurge> {
  const sql = await getKnowledgePoolForOrg(orgSlug);
  const purge = await sql.begin(async (tx) => {
    const chunks = await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks WHERE org_slug = $1`,
      [orgSlug],
    );
    const documents = await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
      [orgSlug],
    );
    await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.semantic_cache WHERE org_slug = $1`,
      [orgSlug],
    );

    // Take the domain rows first (the lock a registration in flight also
    // holds from its upsert to its commit), so the "nobody holds it" test
    // below never runs between another org's two writes.
    const held = await tx.unsafe<{ domain: string }[]>(
      `SELECT domain FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships
        WHERE org_slug = $1`,
      [orgSlug],
    );
    const domains = held.map((row) => row.domain);
    let websites = 0;
    if (domains.length > 0) {
      await tx.unsafe(
        `SELECT 1 FROM ${PUBLIC_WEB_SCHEMA}.websites
          WHERE domain = ANY($1) FOR UPDATE`,
        [domains],
      );
      await tx.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships
          WHERE org_slug = $1`,
        [orgSlug],
      );
      const removed = await tx.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.websites w
          WHERE w.domain = ANY($1)
            AND NOT EXISTS (
              SELECT 1 FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
               WHERE m.domain = w.domain
            )`,
        [domains],
      );
      websites = removed.count;
    }
    return {
      documents: documents.count,
      chunks: chunks.count,
      websiteMemberships: domains.length,
      websites,
    };
  });
  // The org's resolved database is about to lose its config file.
  invalidateOrgUrl(orgSlug);
  return purge;
}
