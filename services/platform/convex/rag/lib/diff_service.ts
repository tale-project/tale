'use node';

/**
 * Document comparison service using deterministic text diffing.
 *
 * Paragraph-level comparison with change-block grouping, text normalization,
 * and divergence detection. Ports `diff_service.py`; `difflib.SequenceMatcher`
 * is reimplemented here as `sequenceMatcherOpcodes` with the same opcode
 * semantics (Ratcliff/Obershelp longest-matching-block recursion).
 */

export const CONTEXT_TRUNCATE_CHARS = 200;
export const MERGE_GAP_THRESHOLD = 5;
export const DIVERGENCE_THRESHOLD = 0.7;
export const INLINE_DIFF_MAX_CHARS = 2000;

const CLAUSE_REF_PATTERN =
  /(?:Section|Ziff\.|Ziffer|§§?|Art\.|Artikel|Abs\.|Absatz|Abschnitt|Klausel|Anhang)\s*(\d+(?:\.\d+)*(?:\s*(?:bis|und|,|-)\s*\d+(?:\.\d+)*)*)(?:\s*ff\.)?/i;

export type DiffOpcode = [
  'equal' | 'replace' | 'delete' | 'insert',
  number,
  number,
  number,
  number,
];

/**
 * Compute SequenceMatcher opcodes between two sequences, matching Python's
 * `difflib.SequenceMatcher.get_opcodes()` (Ratcliff/Obershelp). `autojunk` is
 * disabled to match the call sites (`autojunk=False`).
 */
export function sequenceMatcherOpcodes<T>(a: T[], b: T[]): DiffOpcode[] {
  // b2j: map each element of b to the list of its indices.
  const b2j = new Map<T, number[]>();
  for (let i = 0; i < b.length; i += 1) {
    const list = b2j.get(b[i]);
    if (list) {
      list.push(i);
    } else {
      b2j.set(b[i], [i]);
    }
  }

  function findLongestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i]) ?? [];
      for (const j of indices) {
        if (j < blo) {
          continue;
        }
        if (j >= bhi) {
          break;
        }
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // Extend the match in both directions (no junk handling needed).
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  type Block = [number, number, number];
  const matchingBlocks: Block[] = [];
  const queue: [number, number, number, number][] = [
    [0, a.length, 0, b.length],
  ];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) {
      break;
    }
    const [alo, ahi, blo, bhi] = next;
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k > 0) {
      matchingBlocks.push([i, j, k]);
      if (alo < i && blo < j) {
        queue.push([alo, i, blo, j]);
      }
      if (i + k < ahi && j + k < bhi) {
        queue.push([i + k, ahi, j + k, bhi]);
      }
    }
  }
  matchingBlocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  matchingBlocks.push([a.length, b.length, 0]);

  const opcodes: DiffOpcode[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj, size] of matchingBlocks) {
    let tag: DiffOpcode[0] | '' = '';
    if (i < ai && j < bj) {
      tag = 'replace';
    } else if (i < ai) {
      tag = 'delete';
    } else if (j < bj) {
      tag = 'insert';
    }
    if (tag) {
      opcodes.push([tag, i, ai, j, bj]);
    }
    i = ai + size;
    j = bj + size;
    if (size > 0) {
      opcodes.push(['equal', ai, i, bj, j]);
    }
  }
  return opcodes;
}

interface DiffItemData {
  type: 'added' | 'deleted' | 'modified' | 'context';
  base_content?: string | null;
  comparison_content?: string | null;
  content?: string | null;
  inline_diff?: string | null;
  clause_ref?: string | null;
  base_page?: number | null;
  comparison_page?: number | null;
}

function diffItemToDict(item: DiffItemData): Record<string, unknown> {
  if (item.type === 'context') {
    return { type: 'context', content: item.content };
  }
  const result: Record<string, unknown> = {
    type: item.type,
    base_content: item.base_content ?? null,
    comparison_content: item.comparison_content ?? null,
  };
  if (item.inline_diff != null) {
    result.inline_diff = item.inline_diff;
  }
  if (item.clause_ref != null) {
    result.clause_ref = item.clause_ref;
  }
  if (item.base_page != null) {
    result.base_page = item.base_page;
  }
  if (item.comparison_page != null) {
    result.comparison_page = item.comparison_page;
  }
  return result;
}

interface DiffStats {
  total_paragraphs_base: number;
  total_paragraphs_comparison: number;
  unchanged: number;
  modified: number;
  added: number;
  deleted: number;
  high_divergence: boolean;
}

export interface DiffResultDict {
  change_blocks: Record<string, unknown>[];
  stats: DiffStats;
  truncated: boolean;
}

/** Word-level inline diff with `[-deleted-]` and `{+added+}` markers. */
export function computeInlineDiff(
  base: string,
  comparison: string,
): string | null {
  if (
    base.length > INLINE_DIFF_MAX_CHARS ||
    comparison.length > INLINE_DIFF_MAX_CHARS
  ) {
    return null;
  }
  const baseWords = base.split(/\s+/).filter((w) => w.length > 0);
  const compWords = comparison.split(/\s+/).filter((w) => w.length > 0);
  if (baseWords.length === 0 && compWords.length === 0) {
    return null;
  }

  const opcodes = sequenceMatcherOpcodes(baseWords, compWords);
  const parts: string[] = [];
  for (const [tag, i1, i2, j1, j2] of opcodes) {
    if (tag === 'equal') {
      parts.push(baseWords.slice(i1, i2).join(' '));
    } else if (tag === 'replace') {
      parts.push(`[-${baseWords.slice(i1, i2).join(' ')}-]`);
      parts.push(`{+${compWords.slice(j1, j2).join(' ')}+}`);
    } else if (tag === 'delete') {
      parts.push(`[-${baseWords.slice(i1, i2).join(' ')}-]`);
    } else {
      parts.push(`{+${compWords.slice(j1, j2).join(' ')}+}`);
    }
  }
  return parts.join(' ');
}

/** Extract the first clause/section reference from paragraph text. */
export function extractClauseRef(text: string): string | null {
  const match = CLAUSE_REF_PATTERN.exec(text);
  return match ? match[0].trim() : null;
}

const QUOTE_MAP: Record<string, string> = {
  '“': '"',
  '”': '"',
  '„': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '«': '"',
  '»': '"',
};

const DASH_MAP: Record<string, string> = {
  '—': '--',
  '–': '--',
  '‒': '-',
  '―': '--',
};

const IMAGE_PATTERN = /\[Image:[^\]]*\]/g;
const TABLE_PREFIX_PATTERN = /^\[Table\]\s*/gm;
const MULTI_SPACE = /[ \t]{2,}/g;

/** Normalize text for stable diffing. */
export function normalizeText(text: string): string {
  let out = text.replace(/[“”„‘’‚«»]/g, (c) => QUOTE_MAP[c] ?? c);
  out = out.replace(/[—–‒―]/g, (c) => DASH_MAP[c] ?? c);
  out = out.replace(IMAGE_PATTERN, '');
  out = out.replace(TABLE_PREFIX_PATTERN, '');
  out = out.replace(MULTI_SPACE, ' ');
  const lines = out.split('\n').map((line) => line.replace(/\s+$/, ''));
  return lines.join('\n');
}

/** Split text into paragraphs by double newlines, filtering empties. */
export function splitParagraphs(text: string): string[] {
  return text
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function truncate(text: string, maxChars = CONTEXT_TRUNCATE_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function buildPageMap(nParagraphs: number, pageBreaks: number[]): number[] {
  if (pageBreaks.length === 0) {
    return new Array<number>(nParagraphs).fill(1);
  }
  const pages: number[] = [];
  let currentPage = 1;
  let breakIdx = 0;
  for (let i = 0; i < nParagraphs; i += 1) {
    if (breakIdx < pageBreaks.length && i >= pageBreaks[breakIdx]) {
      currentPage += 1;
      breakIdx += 1;
    }
    pages.push(currentPage);
  }
  return pages;
}

export interface ComputeDiffOptions {
  maxChanges?: number;
  basePageBreaks?: number[] | null;
  compPageBreaks?: number[] | null;
}

type Segment =
  | { type: 'equal'; data: string[] }
  | { type: 'change'; data: DiffItemData[] };

/** Compute paragraph-level diff between two documents. */
export function computeDiff(
  baseText: string,
  comparisonText: string,
  options: ComputeDiffOptions = {},
): DiffResultDict {
  const maxChanges = options.maxChanges ?? 500;
  const basePageBreaks = options.basePageBreaks ?? [];
  const compPageBreaks = options.compPageBreaks ?? [];

  const baseParas = splitParagraphs(normalizeText(baseText));
  const compParas = splitParagraphs(normalizeText(comparisonText));

  const basePages = buildPageMap(baseParas.length, basePageBreaks);
  const compPages = buildPageMap(compParas.length, compPageBreaks);
  const hasPages = basePageBreaks.length > 0 || compPageBreaks.length > 0;

  const opcodes = sequenceMatcherOpcodes(baseParas, compParas);

  const stats: DiffStats = {
    total_paragraphs_base: baseParas.length,
    total_paragraphs_comparison: compParas.length,
    unchanged: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    high_divergence: false,
  };

  const segments: Segment[] = [];

  for (const [tag, i1, i2, j1, j2] of opcodes) {
    if (tag === 'equal') {
      const equalParas = baseParas.slice(i1, i2);
      stats.unchanged += equalParas.length;
      segments.push({ type: 'equal', data: equalParas });
    } else if (tag === 'replace') {
      const items: DiffItemData[] = [];
      const baseSlice = baseParas.slice(i1, i2);
      const compSlice = compParas.slice(j1, j2);
      const maxLen = Math.max(baseSlice.length, compSlice.length);
      for (let k = 0; k < maxLen; k += 1) {
        const b = k < baseSlice.length ? baseSlice[k] : null;
        const c = k < compSlice.length ? compSlice[k] : null;
        if (b !== null && c !== null) {
          const item: DiffItemData = {
            type: 'modified',
            base_content: b,
            comparison_content: c,
            inline_diff: computeInlineDiff(b, c),
            clause_ref: extractClauseRef(c) ?? extractClauseRef(b),
          };
          if (hasPages) {
            item.base_page =
              i1 + k < basePages.length ? basePages[i1 + k] : null;
            item.comparison_page =
              j1 + k < compPages.length ? compPages[j1 + k] : null;
          }
          items.push(item);
          stats.modified += 1;
        } else if (b === null && c !== null) {
          const item: DiffItemData = {
            type: 'added',
            comparison_content: c,
            clause_ref: extractClauseRef(c),
          };
          if (hasPages) {
            item.comparison_page =
              j1 + k < compPages.length ? compPages[j1 + k] : null;
          }
          items.push(item);
          stats.added += 1;
        } else if (b !== null) {
          const item: DiffItemData = {
            type: 'deleted',
            base_content: b,
            clause_ref: extractClauseRef(b),
          };
          if (hasPages) {
            item.base_page =
              i1 + k < basePages.length ? basePages[i1 + k] : null;
          }
          items.push(item);
          stats.deleted += 1;
        }
      }
      segments.push({ type: 'change', data: items });
    } else if (tag === 'insert') {
      const items: DiffItemData[] = [];
      for (let j = j1; j < j2; j += 1) {
        const item: DiffItemData = {
          type: 'added',
          comparison_content: compParas[j],
          clause_ref: extractClauseRef(compParas[j]),
        };
        if (hasPages) {
          item.comparison_page = j < compPages.length ? compPages[j] : null;
        }
        items.push(item);
      }
      stats.added += j2 - j1;
      segments.push({ type: 'change', data: items });
    } else {
      // delete
      const items: DiffItemData[] = [];
      for (let i = i1; i < i2; i += 1) {
        const item: DiffItemData = {
          type: 'deleted',
          base_content: baseParas[i],
          clause_ref: extractClauseRef(baseParas[i]),
        };
        if (hasPages) {
          item.base_page = i < basePages.length ? basePages[i] : null;
        }
        items.push(item);
      }
      stats.deleted += i2 - i1;
      segments.push({ type: 'change', data: items });
    }
  }

  const totalParas = Math.max(baseParas.length, compParas.length, 1);
  const changed = stats.modified + stats.added + stats.deleted;
  stats.high_divergence = changed / totalParas > DIVERGENCE_THRESHOLD;

  const { blocks, truncated } = groupIntoBlocks(segments, maxChanges);

  return {
    change_blocks: blocks.map((block) => ({
      context_before: block.contextBefore,
      items: block.items.map(diffItemToDict),
      context_after: block.contextAfter,
    })),
    stats,
    truncated,
  };
}

interface OpenBlock {
  contextBefore: string | null;
  items: DiffItemData[];
  contextAfter: string | null;
}

function groupIntoBlocks(
  segments: Segment[],
  maxChanges: number,
): { blocks: OpenBlock[]; truncated: boolean } {
  const blocks: OpenBlock[] = [];
  let currentBlock: OpenBlock | null = null;
  let totalItems = 0;
  let truncated = false;
  let lastEqual: string[] | null = null;

  for (const segment of segments) {
    if (segment.type === 'equal') {
      const equalParas = segment.data;
      if (currentBlock !== null) {
        if (equalParas.length <= MERGE_GAP_THRESHOLD) {
          for (const p of equalParas) {
            currentBlock.items.push({ type: 'context', content: truncate(p) });
          }
        } else {
          currentBlock.contextAfter = truncate(equalParas[0]);
          blocks.push(currentBlock);
          currentBlock = null;
        }
      }
      lastEqual = equalParas;
    } else {
      let changeItems = segment.data;

      if (totalItems + changeItems.length > maxChanges) {
        const remaining = maxChanges - totalItems;
        if (remaining > 0) {
          changeItems = changeItems.slice(0, remaining);
          truncated = true;
        } else {
          truncated = true;
          break;
        }
      }

      if (currentBlock === null) {
        let ctxBefore: string | null = null;
        if (lastEqual && lastEqual.length > 0) {
          ctxBefore = truncate(lastEqual[lastEqual.length - 1]);
        }
        currentBlock = {
          contextBefore: ctxBefore,
          items: [],
          contextAfter: null,
        };
      }

      currentBlock.items.push(...changeItems);
      totalItems += changeItems.length;

      if (truncated) {
        break;
      }
    }
  }

  if (currentBlock !== null && currentBlock.items.length > 0) {
    blocks.push(currentBlock);
  }

  return { blocks, truncated };
}
