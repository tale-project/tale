#!/usr/bin/env bun
// Normalizes GitHub-flavored Markdown tables across base locales:
//   * pipes aligned vertically
//   * cells padded to the maximum column width
//   * single space on either side of the cell text
//
// Runs on the three base locales only (`docs/`, `docs/de/`, `docs/fr/`). Variant
// locales are regenerated from the base, so they inherit the fix automatically.
// Code fences and frontmatter are preserved verbatim.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(currentDir);

const BASE_LOCALES = ['.', 'de', 'fr'] as const;
const SKIP_DIRS = new Set([
  'node_modules',
  'scripts',
  'images',
  'de-AT',
  'de-CH',
  'fr-CH',
  '.locale-overrides',
]);
const SKIP_FILES = new Set(['AGENTS.md', 'README.md', 'CONTRIBUTING.md']);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (
      (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) &&
      !SKIP_FILES.has(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

// Visible width — counts graphemes roughly by code points, ignoring combining
// marks. Good enough for docs prose; not a full Unicode-grapheme implementation.
function cellWidth(cell: string): number {
  return [...cell].length;
}

function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  // Split on unescaped pipes. GitHub tables don't support escaped pipes inside
  // cells that matter for our docs, so a simple split is fine.
  const inner = trimmed.slice(1, -1);
  return inner.split('|').map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

type Alignment = 'left' | 'right' | 'center';

function alignmentFromSeparator(cell: string): Alignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function pad(cell: string, width: number, align: Alignment): string {
  const current = cellWidth(cell);
  if (current >= width) return cell;
  const diff = width - current;
  if (align === 'right') return ' '.repeat(diff) + cell;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + cell + ' '.repeat(right);
  }
  return cell + ' '.repeat(diff);
}

function formatTable(rows: string[][], alignments: Alignment[]): string[] {
  const cols = alignments.length;
  const widths = new Array<number>(cols).fill(3); // separator needs at least 3 dashes
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i]!, cellWidth(row[i] ?? ''));
    }
  }
  const out: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const isSep = r === 1;
    const cells = widths.map((w, i) => {
      if (isSep) {
        const align = alignments[i]!;
        const dashes = '-'.repeat(w);
        if (align === 'center')
          return `:${dashes.slice(0, -2)}-:`.length >= w
            ? `:${'-'.repeat(w - 2)}:`
            : dashes;
        if (align === 'right') return `${'-'.repeat(w - 1)}:`;
        return dashes;
      }
      return pad(row[i] ?? '', w, alignments[i] ?? 'left');
    });
    out.push('| ' + cells.join(' | ') + ' |');
  }
  return out;
}

function formatTablesInMarkdown(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;
  let inFence = false;
  let inFrontmatter = false;
  let frontmatterDone = false;

  while (i < lines.length) {
    const line = lines[i]!;

    // Frontmatter is the first `---`..`---` block at the top.
    if (!frontmatterDone && i === 0 && line === '---') {
      inFrontmatter = true;
      out.push(line);
      i++;
      continue;
    }
    if (inFrontmatter) {
      out.push(line);
      if (line === '---') {
        inFrontmatter = false;
        frontmatterDone = true;
      }
      i++;
      continue;
    }

    // Fenced code blocks — pass through untouched.
    if (line.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    // Try to parse a table: header row + separator row + zero or more data rows.
    const header = parseRow(line);
    if (header) {
      const separator = i + 1 < lines.length ? parseRow(lines[i + 1]!) : null;
      if (
        separator &&
        isSeparatorRow(separator) &&
        separator.length === header.length
      ) {
        const alignments = separator.map(alignmentFromSeparator);
        const rows: string[][] = [header, separator];
        let j = i + 2;
        while (j < lines.length) {
          const r = parseRow(lines[j]!);
          if (!r || r.length !== header.length) break;
          rows.push(r);
          j++;
        }
        out.push(...formatTable(rows, alignments));
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }

  return out.join('\n');
}

const filesToFormat: string[] = [];
for (const locale of BASE_LOCALES) {
  const dir = locale === '.' ? DOCS : join(DOCS, locale);
  for (const f of await walk(dir)) filesToFormat.push(f);
}

let changed = 0;
for (const file of filesToFormat) {
  const before = await readFile(file, 'utf8');
  const after = formatTablesInMarkdown(before);
  if (after !== before) {
    await writeFile(file, after);
    console.log(`formatted: ${relative(DOCS, file)}`);
    changed++;
  }
}
console.log(
  `Tables normalized in ${changed} of ${filesToFormat.length} file(s).`,
);
