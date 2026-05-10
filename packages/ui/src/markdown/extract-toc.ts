import { slugifyHeading } from './anchored-heading';

export interface TocEntry {
  level: 2 | 3;
  text: string;
  id: string;
}

/**
 * Pull the h2/h3 outline out of a markdown body for the right-rail "on
 * this page" sidebar. Skips headings inside fenced code blocks and lines
 * commented out by HTML `<!-- -->` tags.
 */
export function extractToc(body: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let inFence = false;
  let inComment = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes('<!--')) inComment = true;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const match = /^(#{2,3})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length === 2 ? 2 : 3;
    // Strip the markdown formatting that ReactMarkdown unwraps before
    // AnchoredHeading sees the text, otherwise the TOC slug diverges
    // from the rendered DOM id and the anchor link 404s.
    let rawText = match[2];
    // Pandoc-style explicit-id token at the end (`{#custom-id}`). Pull it
    // out so the TOC entry's `id` matches what AnchoredHeading renders;
    // strip it from the visible label too.
    let explicitId: string | undefined;
    const idMatch = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/.exec(rawText);
    if (idMatch) {
      explicitId = idMatch[1];
      rawText = rawText.slice(0, idMatch.index).replace(/\s+$/, '');
    }
    const text = rawText
      // ![alt](url) -> alt (run before the link strip below — otherwise
      // the link rule turns `![alt](url)` into `!alt` and the image
      // pattern can't match the leading `!` anymore).
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // [label](url) / [label][ref] -> label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      // **bold**, *em*, __bold__, _em_, ~~strike~~
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      // inline code
      .replace(/`([^`]*)`/g, '$1')
      .trim();
    if (!text) continue;
    entries.push({ level, text, id: explicitId ?? slugifyHeading(text) });
  }
  return entries;
}
