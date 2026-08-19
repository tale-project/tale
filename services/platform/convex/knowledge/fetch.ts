'use node';

/**
 * Whole-content reads from the knowledge corpora — the SQL behind `rag_fetch`.
 *
 * The corpus READERS (`corpus.ts`) only search: they return ranked passages,
 * never a document. These two functions are the complement — given a ref a
 * search hit carried, load the whole thing:
 *
 *  - a DOCUMENT by its `file_id`, reassembled from its chunks' forward-owning
 *    spans in `chunk_index` order (`core_content`, never `chunk_content` —
 *    bodies overlap and joining them would duplicate every seam);
 *  - a crawled WEB PAGE by its URL, from `website_urls.content` (the full
 *    page text the crawler stored), scoped through the same
 *    `website_org_memberships` join the search legs use.
 *
 * Same tenancy discipline as the readers: the pool is resolved through the
 * per-organization chokepoint, every statement filters on `org_slug` (or the
 * membership join), and a corpus that does not exist yet reads as "not
 * found", never as an error — an organization that has never indexed
 * anything should get an honest miss.
 */

import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../lib/knowledge/types';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import {
  getKnowledgePoolForOrg,
  isUndefinedColumn,
  isUndefinedSchema,
  isUndefinedTable,
} from './pool';

/** One serving of fetched content — enough to answer from, small enough to
 * never flood the model's context (nor the Convex value ceiling). Longer
 * content pages through `offset`; every `rag_fetch` surface shares this
 * window so paging behaves identically wherever the tool is mounted. */
export const FETCH_WINDOW_CHARS = 20_000;

/** Cut one `offset`/`limit` window out of a fetched text, with the follow-up
 * offset when more remains — the paging contract of `rag_fetch` results. */
export function windowText(
  text: string,
  offset: number,
  limit: number,
): { content: string; totalChars: number; nextOffset?: number } {
  const slice = text.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return {
    content: slice,
    totalChars: text.length,
    ...(nextOffset < text.length ? { nextOffset } : {}),
  };
}

/** A document loaded whole from the corpus. */
export interface FetchedDocument {
  readonly fileId: string;
  readonly filename: string | null;
  readonly folderPath: string | null;
  readonly modifiedAt: number | null;
  readonly text: string;
}

/** A crawled page loaded whole from the corpus. */
export interface FetchedWebPage {
  readonly url: string;
  readonly title: string | null;
  readonly lastCrawledAt: number | null;
  readonly text: string;
}

export interface FetchDocumentByFileIdArgs {
  readonly organizationId: string;
  readonly orgSlug: string;
  readonly fileId: string;
  readonly access?: KnowledgeAccessScope;
}

/** True for the error shapes that mean "this corpus was never created". */
function corpusMissing(err: unknown): boolean {
  return (
    isUndefinedTable(err) || isUndefinedColumn(err) || isUndefinedSchema(err)
  );
}

/**
 * Load one document's full text by the `file_id` its search hits carry.
 * Returns null when the organization's corpus has no such document (or no
 * corpus at all).
 *
 * `access` is the caller's document visibility, derived server-side exactly
 * like the search path's (`KnowledgeAccessScope`) — a scoped caller holding a
 * ref (quoted from an old chat, guessed, leaked) must not fetch what a search
 * would never have shown them. The scope stamp rides the row the statement
 * already loads (no second round-trip) and a denial reads as the SAME null as
 * a missing document, so existence never leaks. Absent = org-wide
 * (admin-keyed surfaces), byte-for-byte today's statement.
 */
export async function fetchDocumentByFileId(
  ctx: ActionCtx,
  args: FetchDocumentByFileIdArgs,
): Promise<FetchedDocument | null> {
  const sql = await getKnowledgePoolForOrg(args.orgSlug);
  // The scope columns are selected only for a scoped caller, so an org-wide
  // read of a corpus that predates the scope migrations keeps working.
  // `team_ids` is the full team list of a shared document; `team_id` is its
  // deprecated first-element mirror, still read so a row the `team_ids` DDL
  // backfill has not stamped keeps its single-team visibility.
  const scopeColumns =
    args.access !== undefined
      ? ', d.team_ids, d.team_id, d.project_id, d.conversation_id'
      : '';
  try {
    const documents = await sql.unsafe<
      Array<{
        id: string;
        filename: string | null;
        folder_path: string | null;
        modified_at: Date | null;
        team_ids?: string[] | null;
        team_id?: string | null;
        project_id?: string | null;
        conversation_id?: string | null;
      }>
    >(
      `
      SELECT d.id::text AS id, d.filename, d.folder_path,
             COALESCE(d.source_modified_at, d.updated_at) AS modified_at${scopeColumns}
      FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
      WHERE d.org_slug = $1 AND d.file_id = $2 AND d.status = 'completed'
      LIMIT 1
      `,
      [args.orgSlug, args.fileId],
    );
    const document = documents[0];
    if (!document) return null;
    // A conversation row is decided by the conversation's live assignment, which
    // this SQL cannot see, so scope-by-set does not apply to it — the mandatory
    // Convex-truth re-check below is its gate. All that is decided here is
    // whether such rows are in play for this caller at all: a caller who cannot
    // read conversations gets an honest miss without touching Convex.
    if (document.conversation_id != null) {
      if (args.access !== undefined && !args.access.includeConversationScoped) {
        return null;
      }
    } else if (
      !knowledgeScopeAllows(args.access, {
        teamIds: document.team_ids,
        teamId: document.team_id,
        projectId: document.project_id,
      })
    ) {
      // Out of the caller's scope: an honest miss, decided BEFORE the chunk
      // read so denied content is never even loaded.
      return null;
    }
    const retrievable = await ctx.runQuery(
      internal.documents.internal_queries.filterRetrievableRagFileIds,
      {
        organizationId: args.organizationId,
        fileIds: [args.fileId],
        ...(args.access?.userId !== undefined
          ? { userId: args.access.userId }
          : {}),
        ...(args.access !== undefined
          ? {
              access: {
                teamIds: [...args.access.teamIds],
                projectIds: [...args.access.projectIds],
                includeHub: args.access.includeHub,
                ...(args.access.includeConversationScoped !== undefined
                  ? {
                      includeConversationScoped:
                        args.access.includeConversationScoped,
                    }
                  : {}),
                ...(args.access.threadIds !== undefined
                  ? { threadIds: [...args.access.threadIds] }
                  : {}),
              },
            }
          : {}),
      },
    );
    if (!retrievable.includes(args.fileId)) return null;

    const chunks = await sql.unsafe<Array<{ core_content: string }>>(
      `
      SELECT c.core_content
      FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
      WHERE c.org_slug = $1 AND c.document_id = $2
      ORDER BY c.chunk_index
      `,
      [args.orgSlug, document.id],
    );
    let text = '';
    for (const chunk of chunks) text += chunk.core_content;
    return {
      fileId: args.fileId,
      filename: document.filename,
      folderPath: document.folder_path,
      modifiedAt: document.modified_at ? document.modified_at.getTime() : null,
      text,
    };
  } catch (err) {
    if (corpusMissing(err)) return null;
    throw err;
  }
}

/**
 * Load one crawled page's full text by URL. The URL is matched exactly and
 * with the trailing-slash variant, because a model quoting a search hit's
 * ref should never miss on a slash. Returns null when no membership-visible
 * page matches.
 */
export async function fetchWebPageByUrl(
  orgSlug: string,
  url: string,
): Promise<FetchedWebPage | null> {
  const sql = await getKnowledgePoolForOrg(orgSlug);
  const variants = url.endsWith('/')
    ? [url, url.slice(0, -1)]
    : [url, `${url}/`];
  try {
    const pages = await sql.unsafe<
      Array<{
        url: string;
        title: string | null;
        content: string | null;
        last_crawled_at: Date | null;
      }>
    >(
      `
      SELECT u.url, u.title, u.content, u.last_crawled_at
      FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
      JOIN ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
        ON m.domain = u.domain AND m.org_slug = $1
      WHERE u.url = ANY($2)
      LIMIT 1
      `,
      [orgSlug, variants],
    );
    const page = pages[0];
    if (!page || page.content === null || page.content.length === 0) {
      return null;
    }
    return {
      url: page.url,
      title: page.title,
      lastCrawledAt: page.last_crawled_at
        ? page.last_crawled_at.getTime()
        : null,
      text: page.content,
    };
  } catch (err) {
    if (corpusMissing(err)) return null;
    throw err;
  }
}
