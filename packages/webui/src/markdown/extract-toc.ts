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
    const text = match[2].replace(/`/g, '').trim();
    if (!text) continue;
    entries.push({ level, text, id: slugifyHeading(text) });
  }
  return entries;
}
