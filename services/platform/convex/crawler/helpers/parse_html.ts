'use node';

/**
 * Shared JSDOM entry point for the crawler — every wild-page HTML parse in
 * this subsystem goes through here (content pruning, structured data, title,
 * BFS link discovery).
 *
 * Two things make a bare `new JSDOM(html)` expensive at crawl volume, and
 * neither buys the crawler anything (no consumer reads styles):
 *
 *  - jsdom eagerly parses every inline `<style>` block into a CSSOM; real
 *    pages ship large, often non-standard stylesheets, so this is pure CPU +
 *    heap burn. Blocks are stripped BEFORE construction. (External
 *    stylesheets are never fetched — no `resources` loader — and `style=""`
 *    attributes parse lazily, so those cost nothing here.)
 *  - each failed sheet logs "Could not parse CSS stylesheet" through the
 *    default virtual console; at pages/second that floods the backend log
 *    pipeline. A shared listener-less VirtualConsole drops the residue.
 *
 * This matters doubly because crawler actions run INSIDE the shared Convex
 * backend process — cycles and log lines here are taken directly from
 * interactive traffic (see scan_scheduler.ts's pacing notes).
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

// Listener-less: jsdomError events (CSS parse failures & friends) are
// silently dropped. Scripts never run (no `runScripts`), so nothing a page
// could log is lost either.
const quietConsole = new VirtualConsole();

/** Drop inline `<style>…</style>` blocks (the eager-CSSOM cost) from raw HTML. */
export function stripStyleBlocks(html: string): string {
  return html.replace(STYLE_BLOCK_RE, '');
}

/** Parse crawled HTML into a JSDOM without CSS work or jsdomError log spam. */
export function parseHtml(html: string): JSDOM {
  return new JSDOM(stripStyleBlocks(html), { virtualConsole: quietConsole });
}
