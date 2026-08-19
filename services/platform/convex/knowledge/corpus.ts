'use node';

/**
 * The corpus readers — the SQL behind one organization's two retrieval legs.
 *
 * Each reader is constructed for ONE organization and holds its slug for its
 * whole life. Retrieval never passes an organization around, so there is no
 * branch in which one could be forgotten; the reader simply cannot be pointed
 * at another tenant. The pool it was built on was resolved per organization
 * too, so on a bring-your-own database the other tenants' rows are not even
 * present.
 *
 * Both corpora are scoped, differently:
 *
 *  - `private_knowledge` — every document and chunk carries `org_slug`, and a
 *    database-level composite foreign key makes a chunk of one organization
 *    unable to point at another's document. Both statements filter on it.
 *  - `public_web` — a page is fetched once per domain, and
 *    `website_org_memberships` records which organizations asked for that
 *    domain. Both statements JOIN through it, so a domain this organization
 *    never registered is invisible even though the row is in the same table.
 *
 * The keyword leg returns `null` — not an empty list — when the database has no
 * BM25 index. That distinction is what lets a search report itself as degraded
 * instead of looking like a search that simply found nothing, and it is why a
 * managed Postgres without ParadeDB still serves retrieval rather than erroring
 * on every query.
 */

import type { Sql } from 'postgres';

import { logger } from '../../lib/knowledge/logger';
import type {
  CorpusLegQuery,
  CorpusReader,
} from '../../lib/knowledge/retrieve';
import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
  type KnowledgeCorpus,
  type KnowledgeHit,
} from '../../lib/knowledge/types';
import {
  bm25Available,
  isDataCorrupted,
  isInternalError,
  isUndefinedColumn,
  isUndefinedFunction,
  isUndefinedSchema,
  isUndefinedTable,
  markBm25Unavailable,
} from './pool';

/** Values postgres.js accepts as positional parameters. */
type SqlParam = string | number | boolean | null | Date | string[] | number[];

/** Row shape both corpus queries project into. */
interface CorpusRow {
  id: string;
  chunk_content: string;
  chunk_index: number;
  ref: string;
  title: string | null;
  url: string | null;
  /** The document's project scope stamp; NULL for an org-hub document and for
   * every web page. Selected so a caller can label a hit as belonging to a
   * retired project without a second read. */
  project_id: string | null;
  /** The conversation an emailed attachment arrived on; NULL for a document and
   * for every web page. Selected so the re-check knows which rows it must decide
   * by assignment rather than by scope stamp. */
  conversation_id: string | null;
  modified_at: Date | null;
  /** Char position of the chunk within the ref's fetchable text, cast to
   * text (SUM is bigint); NULL when it cannot be established. */
  hit_offset: string | null;
  score: number;
}

/**
 * Uploaded documents.
 *
 * The optional `refs`, `folder`, and `access` filters restrict WITHIN the
 * organization; they can only ever narrow what the org_slug filter already
 * allowed. `access` is the caller's team/project visibility, derived
 * server-side by the calling surface — see {@link KnowledgeAccessScope}.
 */
export class DocumentCorpusReader implements CorpusReader {
  readonly corpus = 'documents' as const;
  private readonly sql: Sql;
  private readonly orgSlug: string;

  constructor(sql: Sql, orgSlug: string) {
    this.sql = sql;
    this.orgSlug = orgSlug;
  }

  async keyword(
    query: CorpusLegQuery,
  ): Promise<readonly KnowledgeHit[] | null> {
    if (!(await bm25Available(this.sql))) return null;
    const scope = this.scope(query, 2);
    const statement = `
      SELECT c.id::text AS id, c.chunk_content, c.chunk_index,
             d.file_id AS ref, d.filename AS title, NULL::text AS url,
             d.project_id, d.conversation_id,
             COALESCE(d.source_modified_at, d.updated_at) AS modified_at,
             (SELECT COALESCE(SUM(length(c2.core_content)), 0)
                FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c2
               WHERE c2.org_slug = c.org_slug AND c2.document_id = c.document_id
                 AND c2.chunk_index < c.chunk_index)::text AS hit_offset,
             paradedb.score(c.id) AS score
      FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
      JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        ON d.id = c.document_id AND d.org_slug = c.org_slug
      WHERE c.id @@@ paradedb.match('chunk_content', $1)
        AND c.org_slug = $2
        AND d.status = 'completed'
        ${scope.clause}
      ORDER BY score DESC
      LIMIT $${3 + scope.params.length}
    `;
    return this.runKeyword(statement, [
      query.query,
      this.orgSlug,
      ...scope.params,
      query.limit,
    ]);
  }

  async dense(
    query: CorpusLegQuery & { readonly embedding: readonly number[] },
  ): Promise<readonly KnowledgeHit[]> {
    const scope = this.scope(query, 2);
    const statement = `
      SELECT c.id::text AS id, c.chunk_content, c.chunk_index,
             d.file_id AS ref, d.filename AS title, NULL::text AS url,
             d.project_id, d.conversation_id,
             COALESCE(d.source_modified_at, d.updated_at) AS modified_at,
             (SELECT COALESCE(SUM(length(c2.core_content)), 0)
                FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c2
               WHERE c2.org_slug = c.org_slug AND c2.document_id = c.document_id
                 AND c2.chunk_index < c.chunk_index)::text AS hit_offset,
             1 - (c.embedding <=> $1::vector) AS score
      FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
      JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        ON d.id = c.document_id AND d.org_slug = c.org_slug
      WHERE c.embedding IS NOT NULL
        AND c.org_slug = $2
        AND d.status = 'completed'
        ${scope.clause}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $${3 + scope.params.length}
    `;
    return this.runDense(statement, [
      JSON.stringify(query.embedding),
      this.orgSlug,
      ...scope.params,
      query.limit,
    ]);
  }

  /**
   * The optional narrowing filters, as a clause appended AFTER the org filter.
   *
   * `offset` is how many parameters precede these, so the placeholder numbers
   * line up. The organization is not a parameter of this method: it is already
   * bound, and the clause returned here can only narrow.
   */
  private scope(
    query: CorpusLegQuery,
    offset: number,
  ): { clause: string; params: SqlParam[] } {
    const conditions: string[] = [];
    const params: SqlParam[] = [];
    if (query.refs !== undefined && query.refs.length > 0) {
      params.push([...query.refs]);
      conditions.push(`d.file_id = ANY($${offset + params.length})`);
    }
    if (query.folder !== undefined && query.folder !== '') {
      params.push(query.folder);
      const placeholder = `$${offset + params.length}`;
      // The folder itself, or anything beneath it. Compared as a prefix ending
      // in a separator so `/reports` cannot match `/reports-archive`.
      conditions.push(
        `(d.folder_path = ${placeholder} OR left(d.folder_path, char_length(${placeholder}) + 1) = ${placeholder} || '/')`,
      );
    }
    if (query.access !== undefined) {
      // The caller's document visibility. A hub row is one with NO scope —
      // team_ids, team_id, and project_id all NULL — which is also what every
      // row ingested before scoping existed reads as, so unstamped rows keep
      // today's org-wide visibility until the backfill stamps them. Absent
      // access means org-wide (admin-keyed surfaces) and adds no clause.
      const disjuncts: string[] = [];
      if (query.access.includeHub) {
        // `conversation_id IS NULL` is part of being a hub row. Without it an
        // indexed email attachment — which carries no team and no project —
        // would read as org-hub and be visible to everyone, which is the
        // outcome conversation scope exists to prevent.
        disjuncts.push(
          '(d.team_ids IS NULL AND d.team_id IS NULL AND d.project_id IS NULL' +
            ' AND d.conversation_id IS NULL)',
        );
      }
      // Conversation-scoped rows are admitted here and DECIDED by the
      // Convex-truth re-check, which applies `conversationAssignmentAllows`
      // against the conversation's current assignment.
      //
      // Deliberately not `conversation_id = ANY($n)`: that would need the
      // caller's readable conversations enumerated, and assignment privacy makes
      // that an unbounded walk — the reason the chat conversations leg caps its
      // own scan at 300. Admitting and then re-checking is bounded by the result
      // limit instead, and the re-check fails closed, so a path that reaches SQL
      // without it returns rows that are then dropped rather than served.
      if (query.access.includeConversationScoped) {
        disjuncts.push('d.conversation_id IS NOT NULL');
      }
      params.push([...query.access.teamIds]);
      // A document shared to several teams is visible to a member of ANY of
      // them (`team_ids && …`, the array-overlap twin of the listing rule in
      // `convex/lib/team_access.ts`). The single-column leg keeps rows whose
      // array was never stamped (written before the `team_ids` DDL, or by a
      // not-yet-upgraded writer mid-rollout) retrievable by their one team.
      const teamsParam = `$${offset + params.length}`;
      disjuncts.push(
        `d.team_ids && ${teamsParam}::text[]`,
        `(d.team_ids IS NULL AND d.team_id = ANY(${teamsParam}))`,
      );
      params.push([...query.access.projectIds]);
      disjuncts.push(`d.project_id = ANY($${offset + params.length})`);
      conditions.push(`(${disjuncts.join(' OR ')})`);
    }
    return {
      clause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  private runKeyword(
    statement: string,
    params: SqlParam[],
  ): Promise<readonly KnowledgeHit[] | null> {
    return runKeywordLeg(this.sql, this.corpus, statement, params);
  }

  private runDense(
    statement: string,
    params: SqlParam[],
  ): Promise<readonly KnowledgeHit[]> {
    return runDenseLeg(this.sql, this.corpus, statement, params);
  }
}

/**
 * Crawled web pages.
 *
 * Every statement joins `website_org_memberships`, which is what scopes this
 * corpus: the page rows themselves are shared within one database so a domain
 * is fetched and embedded once, and the membership join is the only thing that
 * decides which organization can see it.
 */
export class WebCorpusReader implements CorpusReader {
  readonly corpus = 'web' as const;
  private readonly sql: Sql;
  private readonly orgSlug: string;

  constructor(sql: Sql, orgSlug: string) {
    this.sql = sql;
    this.orgSlug = orgSlug;
  }

  async keyword(
    query: CorpusLegQuery,
  ): Promise<readonly KnowledgeHit[] | null> {
    if (!(await bm25Available(this.sql))) return null;
    const statement = `
      SELECT c.id::text AS id, c.chunk_content, c.chunk_index,
             c.url AS ref, c.title, c.url,
             NULL::text AS project_id, NULL::text AS conversation_id,
             u.last_crawled_at AS modified_at,
             CASE WHEN c.core_content <> ''
                   AND position(c.core_content IN u.content) > 0
                  THEN (position(c.core_content IN u.content) - 1)::text
                  ELSE NULL END AS hit_offset,
             paradedb.score(c.id) AS score
      FROM ${PUBLIC_WEB_SCHEMA}.chunks c
      JOIN ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
        ON m.domain = c.domain AND m.org_slug = $2
      JOIN ${PUBLIC_WEB_SCHEMA}.website_urls u
        ON u.domain = c.domain AND u.url = c.url
      WHERE c.id @@@ paradedb.match('chunk_content', $1)
      ORDER BY score DESC
      LIMIT $3
    `;
    return runKeywordLeg(this.sql, this.corpus, statement, [
      query.query,
      this.orgSlug,
      query.limit,
    ]);
  }

  async dense(
    query: CorpusLegQuery & { readonly embedding: readonly number[] },
  ): Promise<readonly KnowledgeHit[]> {
    const statement = `
      SELECT c.id::text AS id, c.chunk_content, c.chunk_index,
             c.url AS ref, c.title, c.url,
             NULL::text AS project_id, NULL::text AS conversation_id,
             u.last_crawled_at AS modified_at,
             CASE WHEN c.core_content <> ''
                   AND position(c.core_content IN u.content) > 0
                  THEN (position(c.core_content IN u.content) - 1)::text
                  ELSE NULL END AS hit_offset,
             1 - (c.embedding <=> $1::vector) AS score
      FROM ${PUBLIC_WEB_SCHEMA}.chunks c
      JOIN ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
        ON m.domain = c.domain AND m.org_slug = $2
      JOIN ${PUBLIC_WEB_SCHEMA}.website_urls u
        ON u.domain = c.domain AND u.url = c.url
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $3
    `;
    return runDenseLeg(this.sql, this.corpus, statement, [
      JSON.stringify(query.embedding),
      this.orgSlug,
      query.limit,
    ]);
  }
}

/**
 * Run the keyword leg, translating the ways a full-text index can be missing or
 * broken into "no keyword results", never into a failed search.
 *
 * A missing `paradedb` schema or function is remembered on the pool so later
 * searches skip the leg outright; corruption is reported and the search
 * continues dense-only, because an index that needs rebuilding is an operational
 * problem and not a reason to stop answering.
 */
async function runKeywordLeg(
  sql: Sql,
  corpus: Exclude<KnowledgeCorpus, 'all'>,
  statement: string,
  params: SqlParam[],
): Promise<readonly KnowledgeHit[] | null> {
  try {
    return toHits(await sql.unsafe<CorpusRow[]>(statement, params), corpus);
  } catch (err) {
    if (isUndefinedSchema(err) || isUndefinedFunction(err)) {
      markBm25Unavailable(sql);
      logger.warn(
        `this knowledge database has no usable full-text index; searching dense-only from now on: ${describe(err)}`,
      );
      return null;
    }
    if (isDataCorrupted(err) || isInternalError(err)) {
      logger.warn(
        `the ${corpus} full-text index reported a problem and needs rebuilding; searching dense-only: ${describe(err)}`,
      );
      return null;
    }
    if (isUndefinedTable(err) || isUndefinedColumn(err)) {
      logger.info(`the ${corpus} corpus is not created yet on this database`);
      return null;
    }
    throw err;
  }
}

/**
 * Run the dense leg. A corpus that does not exist yet is an empty result, not a
 * failure — an organization that has never indexed anything should get "nothing
 * found", not an error.
 */
async function runDenseLeg(
  sql: Sql,
  corpus: Exclude<KnowledgeCorpus, 'all'>,
  statement: string,
  params: SqlParam[],
): Promise<readonly KnowledgeHit[]> {
  try {
    return toHits(await sql.unsafe<CorpusRow[]>(statement, params), corpus);
  } catch (err) {
    if (isUndefinedTable(err) || isUndefinedColumn(err)) {
      logger.info(`the ${corpus} corpus is not created yet on this database`);
      return [];
    }
    throw err;
  }
}

function toHits(
  rows: readonly CorpusRow[],
  corpus: Exclude<KnowledgeCorpus, 'all'>,
): KnowledgeHit[] {
  const hits: KnowledgeHit[] = [];
  for (const row of rows) {
    hits.push({
      id: row.id,
      corpus,
      // `chunk_content` already carries the contextual header, so a passage
      // read on its own still says which document and section it came from.
      text: row.chunk_content,
      chunkIndex: row.chunk_index,
      ...(row.hit_offset !== null && row.hit_offset !== undefined
        ? { offset: Number(row.hit_offset) }
        : {}),
      source: {
        ref: row.ref,
        title: row.title,
        url: row.url,
        projectId: row.project_id,
        conversationId: row.conversation_id,
        modifiedAt: row.modified_at ? row.modified_at.getTime() : null,
      },
      score: row.score,
    });
  }
  return hits;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
