import MiniSearch, { type AsPlainObject } from 'minisearch';

export interface SearchDoc {
  id: string;
  /** Page title from frontmatter. */
  title: string;
  /** Concatenated h2/h3 headings — boosted at search time. */
  headings: string;
  /** Plain-text body (markdown stripped). */
  body: string;
  /** Absolute URL on the destination site. */
  url: string;
  /** Optional section label for grouping results (e.g. "Platform"). */
  section?: string;
  /** Optional locale tag — used to filter by current language. */
  locale?: string;
}

export interface SerializedIndex {
  index: AsPlainObject;
  docs: SearchDoc[];
}

const FIELDS = ['title', 'headings', 'body'] as const;
const STORE_FIELDS = ['title', 'url', 'section', 'locale'] as const;

export function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: [...FIELDS],
    storeFields: [...STORE_FIELDS],
    searchOptions: {
      boost: { title: 3, headings: 2 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
}

export function buildSearchIndex(docs: readonly SearchDoc[]): SerializedIndex {
  const ms = createMiniSearch();
  ms.addAll(docs as SearchDoc[]);
  return { index: ms.toJSON(), docs: [...docs] };
}

/** Strip markdown to plain text. Keeps inline links' visible text. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links keep label
    .replace(/<[^>]+>/g, ' ') // HTML/JSX tags
    .replace(/^>\s*/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
