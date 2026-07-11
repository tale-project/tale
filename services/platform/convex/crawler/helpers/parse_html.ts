'use node';

/**
 * Shared linkedom entry point for the crawler — every wild-page HTML parse in
 * this subsystem goes through here (content pruning, structured data, title,
 * BFS link discovery).
 *
 * linkedom never wires a CSS engine into HTML parsing: a `<style>` element's
 * `.sheet` is parsed lazily on first read (see linkedom's `HTMLStyleElement`),
 * and no consumer here ever reads it — so, unlike the jsdom this replaces,
 * broken inline stylesheets cost nothing and never spam a virtual console.
 * Blocks are still stripped BEFORE parsing anyway, purely to cut the amount
 * of markup the parser has to walk at crawl volume (real pages ship large,
 * often non-standard stylesheets that are pure overhead for a DOM nobody
 * reads styles from). This matters doubly because crawler actions run INSIDE
 * the shared Convex backend process — cycles here are taken directly from
 * interactive traffic (see scan_scheduler.ts's pacing notes).
 */
import { NodeFilter, parseHTML } from 'linkedom';

const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

/** Drop inline `<style>…</style>` blocks (pure parse-time cost) from raw HTML. */
export function stripStyleBlocks(html: string): string {
  return html.replace(STYLE_BLOCK_RE, '');
}

/** A parsed page, mirroring the `{ window }` shape every call site already uses. */
export interface ParsedHtml {
  window: ReturnType<typeof parseHTML>;
}

/** Parse crawled HTML into a lightweight linkedom document. */
export function parseHtml(html: string): ParsedHtml {
  return { window: parseHTML(stripStyleBlocks(html)) };
}

// Re-exported so consumers that need `NodeFilter` (e.g. `createTreeWalker`)
// get it from this same boundary instead of reaching into `linkedom`
// directly — linkedom's `window` proxy, unlike jsdom's, does not expose
// `NodeFilter` as a global, so it must come from the module import.
export { NodeFilter };
