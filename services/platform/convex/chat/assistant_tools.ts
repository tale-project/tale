'use node';

/**
 * The chat assistant's three tools, executed — the Convex side of
 * `lib/chat/tools.ts`.
 *
 * One factory builds the {@link ChatToolExecutor} a direct chat turn injects
 * into the pipeline. Everything here is READ-ONLY and follows the workspace
 * bridge's discipline (`node_only/sandbox/workspace_tools_bridge.ts`):
 * whatever a tool returns is relayed to the model as the tool result, so
 * every shape is written FOR THE MODEL — structured status + guidance, never
 * a bare throw — and a failure ends the tool call, never the turn. Every
 * dispatch re-resolves the turn user's access the way a user-side read would
 * (`resolveWorkspaceReadAccess`), is audit-logged, and lands in the usage
 * ledger's connector lane.
 *
 * Honesty rules the empty cases: the RAG corpora may simply not be populated
 * (ingest is offline while the knowledge rebuild lands), an organization may
 * have no embedding model configured, and a role may deny a subject — each
 * of those reads differently in the result, so the model can tell the user
 * what is actually going on instead of hallucinating around a silent [].
 *
 * `'use node'` because knowledge search binds an embedder and `web_fetch`
 * does real network I/O.
 */

import {
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_MIN_SIMILARITY,
  CHAT_WIRE_TOOLS,
  CHAT_ASSISTANT_SLUG,
  type ChatToolExecutor,
  type ToolCallRequest,
} from '../../lib/chat';
import { htmlTitle, htmlToText } from '../../lib/knowledge/html-to-text';
import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../lib/knowledge/types';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import {
  FETCH_WINDOW_CHARS,
  fetchDocumentByFileId,
  fetchWebPageByUrl,
  windowText,
} from '../knowledge/fetch';
import { searchKnowledge } from '../knowledge/search';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { SafeFetchError, isPrivateIp, safeFetch } from '../lib/http/safe_fetch';
import { wrapUntrusted } from '../lib/untrusted_content';

/** Who the tools run for. The user is re-checked per dispatch. */
export interface ChatToolContext {
  readonly organizationId: string;
  readonly userId: string;
  /**
   * The turn's thread LINEAGE — the branch root plus every sibling (see
   * `chat/branches.getThreadLineageIds`), already ownership-checked by the
   * send boundary. Unlocks retrieval of this conversation's chat-uploaded
   * documents (they are thread-private, invisible to every other knowledge
   * surface); the whole lineage is needed because uploads bind against the
   * visible thread while a regenerate runs on a hidden sibling. Absent (a
   * test's bare executor) reads as "no thread uploads retrievable".
   */
  readonly threadIds?: readonly string[];
}

/** A page bigger than this is cut BEFORE extraction — a tool result must
 * never threaten the Convex value ceiling. */
const WEB_FETCH_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WEB_FETCH_TIMEOUT_MS = 15_000;
/** Snippet budget per rag_search result. */
const SNIPPET_CHARS = 500;

// ------------------------------------------------------------ result shapes

/** Every tool answers with one of these statuses, so the model always knows
 * whether to present, retry with different arguments, or tell the user. */
type ToolStatus = 'ok' | 'not_found' | 'invalid_args' | 'unavailable' | 'error';

interface ToolFailure {
  readonly status: Exclude<ToolStatus, 'ok'>;
  readonly message: string;
}

function invalidArgs(message: string): ToolFailure {
  return { status: 'invalid_args', message };
}

function clip(text: string, budget: number): string {
  return text.length > budget
    ? `${text.slice(0, budget)}…(+${text.length - budget} chars)`
    : text;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plain-object check as a TYPE GUARD, so tool arguments narrow without an
 * unsafe assertion. */
function isArgsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ----------------------------------------------------------------- executor

/**
 * Build the executor for one turn. Access, audit, and metering happen per
 * dispatch; the org slug resolves once on first use.
 */
export function createChatToolExecutor(
  ctx: ActionCtx,
  who: ChatToolContext,
): ChatToolExecutor {
  let orgSlugPromise: Promise<string> | null = null;
  const orgSlug = (): Promise<string> => {
    orgSlugPromise ??= orgSlugFromId(ctx, who.organizationId);
    return orgSlugPromise;
  };

  /** The turn user's document visibility (their teams + accessible projects
   * + the org hub) — the same rules the library listings enforce, so a chat
   * search can never surface a document the Documents page would hide.
   * Resolved once per turn: membership is already re-checked per dispatch by
   * `readAllowed`, and a mid-turn team change taking one turn to bite is the
   * same window every listing query has. */
  let accessPromise: Promise<KnowledgeAccessScope> | null = null;
  const knowledgeAccess = (): Promise<KnowledgeAccessScope> => {
    accessPromise ??= ctx
      .runQuery(internal.documents.internal_queries.resolveKnowledgeAccess, {
        organizationId: who.organizationId,
        userId: who.userId,
      })
      // The turn's own lineage widens the scope to ITS chat uploads — and
      // only its own; the ids were ownership-checked at the send boundary.
      .then((base) =>
        who.threadIds !== undefined && who.threadIds.length > 0
          ? { ...base, threadIds: [...who.threadIds] }
          : base,
      );
    return accessPromise;
  };

  /** Role-matrix read check for one subject; a denial is a result, not a
   * throw, so one denied leg never hides the others. */
  const readAllowed = async (
    subject: 'documents' | 'contacts' | 'products' | 'websites',
  ): Promise<boolean> => {
    const access = await ctx.runQuery(
      internal.sandbox.workspace_access.resolveWorkspaceReadAccess,
      { organizationId: who.organizationId, userId: who.userId, subject },
    );
    return access.allowed;
  };

  /** Best-effort observability: the audit row and the ledger row must never
   * fail a tool call the model already made. */
  const recordDispatch = async (
    tool: string,
    status: ToolStatus,
    detail?: string,
  ): Promise<void> => {
    try {
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
          organizationId: who.organizationId,
          actorId: who.userId,
          actorType: 'user',
          action: `chat.tool.${tool}`,
          category: 'ai',
          resourceType: 'chat_tool',
          resourceId: tool,
          status: status === 'ok' ? 'success' : 'failure',
          ...(detail !== undefined ? { errorMessage: clip(detail, 300) } : {}),
        },
      );
      await ctx.runMutation(
        internal.governance.internal_mutations.recordConnectorUsage,
        {
          organizationId: who.organizationId,
          userId: who.userId,
          agentSlug: CHAT_ASSISTANT_SLUG,
          connectorName: 'chat-tools',
          connectorOperation: tool,
          costEstimateCents: 0,
          timestamp: Date.now(),
        },
      );
    } catch (error) {
      console.warn(
        `[chat] tool dispatch bookkeeping failed for ${tool}: ${describeError(error)}`,
      );
    }
  };

  const execute = async (call: ToolCallRequest): Promise<unknown> => {
    if (call.rawInput !== undefined) {
      return invalidArgs(
        `The arguments were not valid JSON (got: ${clip(call.rawInput, 200)}). Send a well-formed JSON object.`,
      );
    }
    const args = isArgsRecord(call.input) ? call.input : {};
    // The never-throws contract, enforced here for the paths the handlers do
    // not guard themselves (an org-slug read, an entity query, a corpus error
    // that is not "corpus missing"): one failed tool call must cost the model
    // one correctable result, never the whole turn.
    try {
      switch (call.name) {
        case 'rag_search':
          return await ragSearch(args);
        case 'rag_fetch':
          return await ragFetch(args);
        case 'web_fetch':
          return await webFetch(args);
        default:
          return invalidArgs(
            `Unknown tool "${call.name}". Available: rag_search, rag_fetch, web_fetch.`,
          );
      }
    } catch (error) {
      console.warn(
        `[chat] tool ${call.name} failed unexpectedly: ${describeError(error)}`,
      );
      return {
        status: 'error',
        message: `The tool failed: ${clip(describeError(error), 200)}. Tell the user; retrying the same call is unlikely to help.`,
      } satisfies ToolFailure;
    }
  };

  // ------------------------------------------------------------- rag_search

  interface SearchResultEntry {
    readonly kind:
      | 'document'
      | 'web-page'
      | 'knowledge-entry'
      | 'product'
      | 'contact'
      | 'website';
    readonly title: string;
    /** What `rag_fetch` accepts: a document file id or a page URL. Entity
     * rows carry their content inline instead. */
    readonly ref?: string;
    readonly url?: string;
    readonly snippet?: string;
    /** Char position of the match within the ref's full text — a rag_fetch
     * starting offset that lands on the match instead of the start. */
    readonly offset?: number;
    /** Retrieval ranking (reranker score when one ran, else the fusion
     * score). Orders hits within ONE response only — the fusion score is a
     * reciprocal-rank value, not a similarity, so its absolute magnitude
     * means nothing across searches. */
    readonly score?: number;
    readonly data?: Record<string, unknown>;
  }

  const ragSearch = async (args: Record<string, unknown>): Promise<unknown> => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query === '') {
      const result = invalidArgs(
        'rag_search needs a non-empty "query" string.',
      );
      await recordDispatch('rag_search', result.status, result.message);
      return result;
    }
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(Math.floor(args.limit), RAG_SEARCH_MAX_LIMIT)
        : RAG_SEARCH_DEFAULT_LIMIT;

    const slug = await orgSlug();
    /** Per-source outcome, so an empty answer is attributable. */
    const sources: Record<string, string> = {};
    const results: SearchResultEntry[] = [];

    const [
      documentsAllowed,
      contactsAllowed,
      productsAllowed,
      websitesAllowed,
    ] = await Promise.all([
      readAllowed('documents'),
      readAllowed('contacts'),
      readAllowed('products'),
      readAllowed('websites'),
    ]);

    // Leg 1 — the RAG corpora (documents + crawled pages), vector+keyword.
    // Scoped to the turn user's own visibility: team libraries they belong
    // to, projects they can read, and the org hub — never the whole org.
    // The similarity floor drops weak dense neighbours BEFORE they reach the
    // model; keyword (BM25) hits are never floored.
    if (documentsAllowed) {
      try {
        const knowledge = await searchKnowledge(ctx, {
          organizationId: who.organizationId,
          orgSlug: slug,
          query,
          corpus: 'all',
          limit,
          minSimilarity: RAG_SEARCH_MIN_SIMILARITY,
          access: await knowledgeAccess(),
        });
        for (const hit of knowledge.hits) {
          const score = hit.rerankScore ?? hit.fusedScore;
          results.push({
            kind: hit.corpus === 'documents' ? 'document' : 'web-page',
            title: hit.source.title ?? hit.source.ref,
            ref: hit.source.ref,
            ...(hit.source.url ? { url: hit.source.url } : {}),
            snippet: clip(hit.text, SNIPPET_CHARS),
            ...(hit.offset !== undefined ? { offset: hit.offset } : {}),
            score: Math.round(score * 1000) / 1000,
          });
        }
        sources.documents = knowledge.hits.some((h) => h.corpus === 'documents')
          ? 'searched'
          : 'searched (no matches — the document index may also still be empty)';
        sources.webPages = knowledge.hits.some((h) => h.corpus === 'web')
          ? 'searched'
          : 'searched (no matches — no crawled pages may be indexed yet)';
      } catch (error) {
        // No embedding model / unusable corpus — degraded, said out loud.
        sources.documents = `unavailable: ${clip(describeError(error), 200)}`;
        sources.webPages = sources.documents;
      }
    } else {
      sources.documents = 'access denied for your role';
      sources.webPages = sources.documents;
    }

    // Legs 2–5 are capped EACH — never by a global slice over the
    // concatenated list, which would let document hits starve an exact
    // contact or product match out of the results entirely.

    // Leg 2 — knowledge entries (Convex rows; lexical topic match).
    if (documentsAllowed) {
      const entries = await ctx.runQuery(
        internal.knowledge_entries.internal_queries.listEntriesForAgent,
        {
          organizationId: who.organizationId,
          topic: query,
          paginationOpts: {
            numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
            cursor: null,
          },
        },
      );
      for (const entry of entries.page) {
        results.push({
          kind: 'knowledge-entry',
          title: entry.topic,
          snippet: clip(entry.content, SNIPPET_CHARS * 2),
        });
      }
      sources.knowledgeEntries =
        entries.page.length > 0 ? 'searched' : 'searched (no matches)';
    } else {
      sources.knowledgeEntries = 'access denied for your role';
    }

    // Leg 3 — contacts (lexical).
    if (contactsAllowed) {
      const contacts = await ctx.runQuery(
        internal.contacts.internal_queries.queryContacts,
        {
          organizationId: who.organizationId,
          searchTerm: query,
          paginationOpts: {
            numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
            cursor: null,
          },
        },
      );
      for (const contact of contacts.page) {
        results.push({
          kind: 'contact',
          title: contact.name ?? 'Unnamed contact',
          data: {
            ...(contact.email ? { email: contact.email } : {}),
            ...(contact.phone ? { phone: contact.phone } : {}),
            ...(contact.tags && contact.tags.length > 0
              ? { tags: contact.tags }
              : {}),
          },
        });
      }
      sources.contacts =
        contacts.page.length > 0 ? 'searched' : 'searched (no matches)';
    } else {
      sources.contacts = 'access denied for your role';
    }

    // Leg 4 — products (lexical).
    if (productsAllowed) {
      const products = await ctx.runQuery(
        internal.products.internal_queries.queryProducts,
        {
          organizationId: who.organizationId,
          searchTerm: query,
          paginationOpts: {
            numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
            cursor: null,
          },
        },
      );
      for (const product of products.page) {
        results.push({
          kind: 'product',
          title: product.name ?? 'Unnamed product',
          data: {
            ...(product.category ? { category: product.category } : {}),
            ...(product.price !== undefined ? { price: product.price } : {}),
            ...(product.stock !== undefined ? { stock: product.stock } : {}),
          },
        });
      }
      sources.products =
        products.page.length > 0 ? 'searched' : 'searched (no matches)';
    } else {
      sources.products = 'access denied for your role';
    }

    // Leg 5 — registered websites (domain metadata; pages are leg 1).
    if (websitesAllowed) {
      const websites = await ctx.runQuery(
        internal.websites.internal_queries.listWebsiteSummaries,
        { organizationId: who.organizationId },
      );
      const needle = query.toLowerCase();
      const matches = websites.filter(
        (site) =>
          site.domain.toLowerCase().includes(needle) ||
          (site.title ?? '').toLowerCase().includes(needle) ||
          (site.description ?? '').toLowerCase().includes(needle),
      );
      for (const site of matches.slice(0, RAG_SEARCH_ENTITY_LIMIT)) {
        results.push({
          kind: 'website',
          title: site.title ?? site.domain,
          url: `https://${site.domain}`,
          ...(site.description
            ? { snippet: clip(site.description, SNIPPET_CHARS) }
            : {}),
        });
      }
      sources.websites =
        matches.length > 0 ? 'searched' : 'searched (no matches)';
    } else {
      sources.websites = 'access denied for your role';
    }

    await recordDispatch('rag_search', 'ok');
    // Every leg is already capped; no global slice. An empty answer says
    // what to do INSTEAD of searching again — the result payload is the
    // steer, not a system rule.
    return {
      status: 'ok',
      query,
      results,
      ...(results.length === 0
        ? {
            message:
              'No matches in the organization’s knowledge. Do not re-run ' +
              'reworded variants of this query. Answer from what you ' +
              'already have — or, when a public page’s URL is known, read ' +
              'it with web_fetch.',
          }
        : {}),
      sources,
    };
  };

  // -------------------------------------------------------------- rag_fetch

  const ragFetch = async (args: Record<string, unknown>): Promise<unknown> => {
    const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
    if (ref === '') {
      const result = invalidArgs(
        'rag_fetch needs a "ref": a document file id or a crawled page URL.',
      );
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }
    const offset =
      typeof args.offset === 'number' && args.offset > 0
        ? Math.floor(args.offset)
        : 0;
    // An explicit range: `limit` caps the returned window below the default,
    // so the model can read exactly the region a search hit points at.
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(Math.floor(args.limit), FETCH_WINDOW_CHARS)
        : FETCH_WINDOW_CHARS;

    const isUrl = ref.startsWith('http://') || ref.startsWith('https://');
    const slug = await orgSlug();

    if (isUrl) {
      if (!(await readAllowed('websites'))) {
        const result: ToolFailure = {
          status: 'unavailable',
          message:
            'Your role does not permit reading websites in this organization.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      const page = await fetchWebPageByUrl(slug, ref);
      if (page === null) {
        const result: ToolFailure = {
          status: 'not_found',
          message:
            "No crawled page with that URL is in this organization's knowledge. " +
            'For a public page outside the knowledge base, use web_fetch.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      const paged = windowText(page.text, offset, limit);
      await recordDispatch('rag_fetch', 'ok');
      return {
        status: 'ok',
        kind: 'web-page',
        url: page.url,
        ...(page.title !== null ? { title: page.title } : {}),
        ...(page.lastCrawledAt !== null
          ? { lastCrawledAt: page.lastCrawledAt }
          : {}),
        totalChars: paged.totalChars,
        offset,
        ...(paged.nextOffset !== undefined
          ? { nextOffset: paged.nextOffset }
          : {}),
        content: wrapUntrusted(paged.content, {
          tool: 'rag_fetch',
          url: page.url,
        }),
      };
    }

    // A document file id.
    if (!(await readAllowed('documents'))) {
      const result: ToolFailure = {
        status: 'unavailable',
        message:
          'Your role does not permit reading documents in this organization.',
      };
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }
    // The turn user's visibility gates the FETCH exactly like the search: a
    // ref in hand (quoted, guessed, remembered from before a scope change) is
    // not a capability, and a denied document reads as the same not_found as
    // a missing one.
    const access = await knowledgeAccess();
    const fromCorpus = await fetchDocumentByFileId(ctx, {
      organizationId: who.organizationId,
      orgSlug: slug,
      fileId: ref,
      access,
    });
    let filename = fromCorpus?.filename ?? null;
    let text =
      fromCorpus !== null && fromCorpus.text.length > 0
        ? fromCorpus.text
        : null;
    if (text === null) {
      // The corpus may not carry it (ingest offline, or a hub-authored
      // document whose text lives inline on the Convex row). The row carries
      // its own scope stamp — the same visibility rule applies before its
      // inline content is served.
      const row = await ctx.runQuery(
        internal.documents.internal_queries.findDocumentByFileId,
        { organizationId: who.organizationId, fileId: ref },
      );
      if (
        row &&
        // `teamTags` is the row's FULL team list (multi-team sharing);
        // visibility is "member of ANY of them", with the legacy single
        // `teamId` as the fallback — the same rule listing applies.
        knowledgeScopeAllows(access, {
          teamIds: row.teamTags ?? null,
          teamId: row.teamId ?? null,
          projectId: row.projectId ?? null,
        }) &&
        typeof row.content === 'string' &&
        row.content.length > 0
      ) {
        text = row.content;
        filename ??= row.title ?? null;
      }
    }
    if (text === null) {
      const result: ToolFailure = {
        status: 'not_found',
        message:
          'No readable content for that file id. The document may not be ' +
          'indexed yet — say so instead of guessing at its contents.',
      };
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }

    // A document that arrived through a video link is third-party content;
    // it reads wrapped, like every other untrusted source.
    let untrustedSourceUrl: string | undefined;
    try {
      const videoSources = await ctx.runQuery(
        internal.file_metadata.internal_queries.lookupVideoLinkSources,
        { storageIds: [ref] },
      );
      if (videoSources.length > 0) {
        untrustedSourceUrl = videoSources[0]?.sourceUrl ?? 'video-link';
      }
    } catch (error) {
      console.warn(
        `[chat] video-link source lookup failed for rag_fetch: ${describeError(error)}`,
      );
    }

    const paged = windowText(text, offset, limit);
    await recordDispatch('rag_fetch', 'ok');
    return {
      status: 'ok',
      kind: 'document',
      ref,
      ...(filename !== null ? { filename } : {}),
      totalChars: paged.totalChars,
      offset,
      ...(paged.nextOffset !== undefined
        ? { nextOffset: paged.nextOffset }
        : {}),
      content:
        untrustedSourceUrl !== undefined
          ? wrapUntrusted(paged.content, {
              tool: 'rag_fetch',
              url: untrustedSourceUrl,
            })
          : paged.content,
    };
  };

  // -------------------------------------------------------------- web_fetch

  const webFetch = async (args: Record<string, unknown>): Promise<unknown> => {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    if (rawUrl === '') {
      const result = invalidArgs('web_fetch needs a "url" string.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      const result = invalidArgs(`"${clip(rawUrl, 200)}" is not a valid URL.`);
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (parsed.protocol !== 'https:') {
      const result = invalidArgs('Only https:// URLs can be fetched.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      const result = invalidArgs('URLs with embedded credentials are refused.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (isPrivateIp(parsed.hostname) || /^[0-9.[\]:]+$/.test(parsed.hostname)) {
      const result = invalidArgs(
        'Bare IP or private-network hosts are refused — fetch a public site by name.',
      );
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }

    let response;
    try {
      response = await safeFetch(parsed.toString(), {
        timeoutMs: WEB_FETCH_TIMEOUT_MS,
        maxResponseBytes: WEB_FETCH_MAX_RESPONSE_BYTES,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'user-agent': 'TaleAssistant/1.0 (+chat web_fetch)',
        },
      });
    } catch (error) {
      const message =
        error instanceof SafeFetchError
          ? `The page could not be fetched (${error.kind}${error.status !== undefined ? ` ${error.status}` : ''}).`
          : `The page could not be fetched: ${clip(describeError(error), 200)}`;
      const result: ToolFailure = { status: 'error', message };
      await recordDispatch('web_fetch', result.status, message);
      return result;
    }

    if (response.status >= 400) {
      const result: ToolFailure = {
        status: 'error',
        message: `The server answered ${response.status} ${response.statusText}.`,
      };
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml');
    const isTextual =
      isHtml ||
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType === '';
    if (!isTextual) {
      const result: ToolFailure = {
        status: 'unavailable',
        message: `The page is "${clip(contentType, 80)}", which this tool cannot read — only HTML and text.`,
      };
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }

    const title = isHtml ? htmlTitle(response.body) : null;
    const text = isHtml ? htmlToText(response.body) : response.body;
    const truncated = text.length > FETCH_WINDOW_CHARS;
    await recordDispatch('web_fetch', 'ok');
    return {
      status: 'ok',
      url: response.finalUrl,
      ...(title !== null ? { title } : {}),
      totalChars: text.length,
      ...(truncated ? { truncatedAt: FETCH_WINDOW_CHARS } : {}),
      content: wrapUntrusted(clip(text, FETCH_WINDOW_CHARS), {
        tool: 'web_fetch',
        url: response.finalUrl,
      }),
    };
  };

  return { wireTools: CHAT_WIRE_TOOLS, execute };
}
