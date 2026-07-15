'use node';

/**
 * Internal action for single-URL fetch + content extraction.
 *
 * Ports the WEBPAGE branch of `services/crawler/app/routers/web.py`
 * (`POST /api/v1/web/fetch-and-extract`): fetch + render the page, convert to
 * markdown, append structured data, and return `{ success, url, title, content,
 * content_type:'webpage', word_count, page_count:1, vision_used:false }`.
 *
 * SCOPE / TODOs (deliberately out of this port):
 *   - The PDF/DOCX/PPTX *document* branch (`_extract_from_file`) and the *image*
 *     branch (`_extract_from_image`) of the Python router downloaded the file and
 *     ran the file-parser / Vision OCR pipeline. That extraction pipeline IS
 *     already ported (`convex/lib/knowledge/extraction`), but wiring it through a
 *     URL download (the Python `app/utils/http_download.py` + content-type probe)
 *     is not done here. For now, a non-HTML content type returns
 *     `{ success:false, error:'unsupported content type (TODO: wire document/image extraction)' }`.
 *     TODO(live-stack): wire URL download -> content-type detection -> the ported
 *     extraction/Vision pipeline so document/image URLs are supported.
 *   - The `instruction` LLM-summarization path (`process_pages_with_llm`) is NOT
 *     implemented. TODO: route `instruction` through the chat/LLM pipeline to
 *     post-process the extracted text.
 *   - SSRF validation (`validate_url_not_private`) is omitted in this port; the
 *     caller / sandbox fetch seam owns network egress policy.
 *   - JS rendering depends on `fetchRenderedHtml`'s render mode (plain fetch by
 *     default; see helpers/fetch_rendered_html.ts).
 *
 * Return values are JSON-serializable. `returns` validators are omitted.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { registrableDomain } from '../browser_sessions/cookie_header';
import { decryptString } from '../lib/crypto/decrypt_string';
import { crawlUrl } from './lib/discovery';

/** Cheap content-type guess from the URL path extension. */
function looksLikeNonHtml(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  if (!lastSegment.includes('.')) {
    return false;
  }
  const ext = `.${lastSegment.split('.').pop()}`;
  const nonHtmlExtensions = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.ppt',
    '.pptx',
    '.txt',
    '.md',
    '.json',
    '.xml',
    '.csv',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.tiff',
    '.svg',
  ]);
  return nonHtmlExtensions.has(ext);
}

export const fetchAndExtract = internalAction({
  args: {
    url: v.string(),
    instruction: v.optional(v.union(v.string(), v.null())),
    timeout: v.optional(v.number()),
    // When provided AND `CRAWLER_RENDER_VIA_SANDBOX=1`, the page fetch is
    // JS-rendered via the spawner (else plain fetch).
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // TODO: the `instruction` LLM-summarization path is not implemented (see
    // module header). Returning the raw extracted content for now.

    // Document/image URLs require the file-extraction + Vision pipeline to be
    // wired through a URL download — out of scope for this port.
    if (looksLikeNonHtml(args.url)) {
      return {
        success: false,
        url: args.url,
        error:
          'unsupported content type (TODO: wire document/image extraction)',
      };
    }

    const timeoutMs = args.timeout ?? 60_000;

    // Claim a pre-warmed browser session for this host (if the pool has one) so
    // a bot-walled site sees a returning visitor. Best-effort — any failure
    // falls through to an ordinary fetch.
    let cookieJar: string | undefined;
    let sessionUserAgent: string | undefined;
    let sessionId: Id<'browserSessions'> | undefined;
    try {
      const domain = registrableDomain(new URL(args.url).hostname);
      const claimed = await ctx.runMutation(
        internal.browser_sessions.sessions.claimBrowserSession,
        { domain },
      );
      if (claimed) {
        cookieJar = await decryptString(claimed.cookiesEncrypted);
        sessionUserAgent = claimed.userAgent;
        sessionId = claimed.sessionId;
      }
    } catch (sessionErr) {
      console.warn(
        '[knowledge] browser-session claim failed; fetching without one:',
        sessionErr instanceof Error ? sessionErr.message : sessionErr,
      );
    }

    const reportSession = async (outcome: 'ok' | 'blocked'): Promise<void> => {
      if (sessionId === undefined) return;
      try {
        await ctx.runMutation(
          internal.browser_sessions.sessions.reportBrowserSessionResult,
          { sessionId, outcome },
        );
      } catch {
        // best-effort — the sweep self-heals a missed report
      }
    };

    let result;
    try {
      result = await crawlUrl(args.url, {
        timeoutMs,
        renderContext: args.organizationId
          ? { ctx, organizationId: args.organizationId }
          : undefined,
        ...(cookieJar ? { cookieJar } : {}),
        ...(sessionUserAgent ? { userAgent: sessionUserAgent } : {}),
      });
      // A 403/429 from a bot wall burns the session; anything else keeps it.
      await reportSession(
        result.status_code === 403 || result.status_code === 429
          ? 'blocked'
          : 'ok',
      );
    } catch (error) {
      // Network-level failures (connection reset, DNS, TLS) throw out of
      // fetch instead of returning a status code — return the same structured
      // failure an HTTP error gets, rather than an uncaught action error.
      console.warn('[knowledge] fetch threw for', args.url, error);
      return {
        success: false,
        url: args.url,
        content_type: 'webpage',
        error: `Failed to fetch ${args.url}: ${error instanceof Error ? error.message : 'network error'}`,
      };
    }

    if (result.content === null) {
      return {
        success: false,
        url: result.url,
        content_type: 'webpage',
        error: `Failed to fetch ${result.url}: HTTP ${result.status_code}`,
      };
    }

    // Append structured data text to the markdown (mirrors the Python
    // `_extract_from_webpage` parts assembly; format_structured_data is left as
    // a JSON dump here since the Python formatter is not part of this port).
    const parts: string[] = [result.content];
    const sd = result.structured_data;
    if (sd && Object.keys(sd).length > 0) {
      try {
        parts.push(JSON.stringify(sd));
      } catch (err) {
        // Non-serializable structured data (e.g. circular refs) is skipped,
        // but log it — silent swallowing would hide a real extraction bug.
        console.warn('Failed to serialize structured_data; skipping:', err);
      }
    }
    const fullText = parts.filter(Boolean).join('\n\n');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    return {
      success: true,
      url: result.url,
      title: result.title,
      content: fullText,
      content_type: 'webpage',
      word_count: wordCount,
      page_count: 1,
      vision_used: false,
    };
  },
});
