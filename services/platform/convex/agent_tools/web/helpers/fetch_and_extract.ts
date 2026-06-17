/**
 * Helper: fetchAndExtract
 *
 * Fetches a URL's content and extracts text using the crawler service.
 * Supports web pages, documents (PDF, DOCX, PPTX), and images (PNG, JPG, etc.).
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import type { WebFetchUrlResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const MAX_CONTENT_LENGTH = 100_000;

export async function fetchAndExtract(
  ctx: ToolCtx,
  args: {
    url: string;
    instruction?: string;
  },
): Promise<WebFetchUrlResult> {
  if (!ctx.organizationId) {
    throw new Error('fetch_and_extract requires organizationId in ToolCtx.');
  }

  debugLog('tool:web:fetch_and_extract start', {
    url: args.url,
    hasInstruction: !!args.instruction,
  });

  try {
    // Resolve the slug INSIDE the try so a lookup failure folds into
    // the same `{ success: false, error }` shape every other failure
    // path returns. Earlier this happened outside the try, which
    // threw raw Error past the tool's contract.
    //
    // The crawler fetch+extract logic now lives in a Convex internal action;
    // the network POST (and its AbortController timeout) was replaced by an
    // in-process `ctx.runAction`. The action returns the same field shape the
    // HTTP response had and throws plain Errors caught below.
    await orgSlugFromId(ctx, ctx.organizationId);

    const result = await ctx.runAction(internal.crawler.web.fetchAndExtract, {
      url: args.url,
      instruction: args.instruction ?? null,
      timeout: 60000,
      // Forward the org so the crawler action can build a sandbox
      // `renderContext` and enable JS-rendering (when
      // `CRAWLER_RENDER_VIA_SANDBOX=1`). Omitting it silently disables
      // rendering — pre-migration the org context reached the crawler via
      // the `x-tale-org` header.
      organizationId: ctx.organizationId,
    });

    if (!result.success) {
      debugLog('tool:web:fetch_and_extract failed', {
        url: args.url,
        error: result.error,
      });
      return {
        operation: 'fetch_url',
        success: false,
        url: args.url,
        content: '',
        word_count: 0,
        page_count: 0,
        vision_used: false,
        error: result.error || 'Failed to fetch and extract content',
      };
    }

    let content = result.content || '';
    const truncated = content.length > MAX_CONTENT_LENGTH;
    if (truncated) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }

    debugLog('tool:web:fetch_and_extract success', {
      url: args.url,
      wordCount: result.word_count,
      pageCount: result.page_count,
      visionUsed: result.vision_used,
      truncated,
    });

    return {
      operation: 'fetch_url',
      success: true,
      url: args.url,
      // The action's return type is a union (success/failure branches);
      // TS can't narrow on the non-literal `success` discriminant, so the
      // success-only fields read as optional here. Coalesce defensively —
      // on the success branch these are always populated at runtime.
      title: result.title ?? undefined,
      content,
      word_count: result.word_count ?? 0,
      page_count: result.page_count ?? 0,
      vision_used: result.vision_used ?? false,
      truncated,
      // The ported crawler action does not return token `usage` (the
      // `instruction` LLM-summarization path is a documented TODO in
      // `convex/crawler/web.ts`), so there is nothing to forward here.
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[tool:web:fetch_and_extract] error', {
      url: args.url,
      error: errorMessage,
    });
    return {
      operation: 'fetch_url',
      success: false,
      url: args.url,
      content: '',
      word_count: 0,
      page_count: 0,
      vision_used: false,
      error: errorMessage,
    };
  }
}
