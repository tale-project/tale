/**
 * rehype-numeric-columns — Right-align table columns whose body cells are
 * all numeric-like.
 *
 * "Numeric-like" covers: integers, decimals, signed numbers (`+5`, `-3.2`),
 * percentages (`12%`), currencies (`$100`, `€9.99`), thousands-separated
 * numbers (`1,234.56`, `1 000`), numbers with a trailing unit (`5kg`,
 * `100 km/h`), ISO/slash dates (`2024-01-15`, `15/01/2024`) and times
 * (`12:00`, `9:30 AM`).
 *
 * The plugin scans each `<table>` in the HAST tree, looks at every body
 * cell per column, and if every non-empty cell in a column is numeric-like
 * it appends `text-right` to both the body cells AND the matching header
 * cell (so the column reads consistently from header to data). Cells with
 * an explicit `align`/`text-align` from GFM column-marker syntax
 * (`| ---: |`) are preserved as-is.
 */

import type { Element, ElementContent, Properties, Root } from 'hast';
import { visit } from 'unist-util-visit';

const RIGHT_ALIGN_CLASS = 'text-right';

const NUMERIC_BODY = /^[-+]?[$€£¥₹]?\s?\d[\d,.  ]*(?:\.\d+)?$/;
const NUMERIC_WITH_SUFFIX =
  /^[-+]?[$€£¥₹]?\s?\d[\d,.  ]*(?:\.\d+)?\s*(?:%|°[CFK]?|[A-Za-z]{1,8}(?:\/[A-Za-z]{1,4})?)$/;
const DATE =
  /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/;
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm))?$/;

function isNumericLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!/\d/.test(trimmed)) return false;
  return (
    NUMERIC_BODY.test(trimmed) ||
    NUMERIC_WITH_SUFFIX.test(trimmed) ||
    DATE.test(trimmed) ||
    TIME.test(trimmed)
  );
}

function getCellText(node: Element): string {
  let text = '';
  const walk = (children: ElementContent[]) => {
    for (const child of children) {
      if (child.type === 'text') {
        text += child.value;
      } else if (child.type === 'element') {
        walk(child.children);
      }
    }
  };
  walk(node.children);
  return text;
}

function hasExplicitAlignment(props: Properties | undefined): boolean {
  if (!props) return false;
  if (props.align) return true;
  const style = props.style;
  if (typeof style === 'string' && /text-align/i.test(style)) return true;
  return false;
}

function appendClass(props: Properties, className: string): void {
  const existing = props.className;
  if (Array.isArray(existing)) {
    if (!existing.includes(className)) existing.push(className);
  } else if (typeof existing === 'string') {
    props.className = existing
      .split(/\s+/)
      .filter(Boolean)
      .concat(existing.split(/\s+/).includes(className) ? [] : [className])
      .join(' ');
  } else {
    props.className = [className];
  }
}

function findChildElement(
  parent: Element,
  tagName: string,
): Element | undefined {
  for (const child of parent.children) {
    if (child.type === 'element' && child.tagName === tagName) return child;
  }
  return undefined;
}

function eachRow(parent: Element): Element[] {
  const rows: Element[] = [];
  for (const child of parent.children) {
    if (child.type === 'element' && child.tagName === 'tr') rows.push(child);
  }
  return rows;
}

function eachCell(row: Element): Element[] {
  const cells: Element[] = [];
  for (const child of row.children) {
    if (
      child.type === 'element' &&
      (child.tagName === 'td' || child.tagName === 'th')
    ) {
      cells.push(child);
    }
  }
  return cells;
}

export function rehypeNumericColumns() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'table') return;
      const tbody = findChildElement(node, 'tbody');
      if (!tbody) return;

      const bodyRows = eachRow(tbody);
      if (bodyRows.length === 0) return;

      // Bucket body cells by column index.
      const columns: { cells: Element[]; texts: string[] }[] = [];
      for (const row of bodyRows) {
        const cells = eachCell(row);
        cells.forEach((cell, colIdx) => {
          if (!columns[colIdx]) columns[colIdx] = { cells: [], texts: [] };
          columns[colIdx].cells.push(cell);
          columns[colIdx].texts.push(getCellText(cell));
        });
      }

      const numericColumns = columns.map(({ texts }) => {
        const nonEmpty = texts.filter((t) => t.trim().length > 0);
        if (nonEmpty.length === 0) return false;
        return nonEmpty.every(isNumericLike);
      });

      // Apply text-right to body cells of numeric columns (skipping cells the
      // author explicitly aligned via GFM column-marker syntax).
      columns.forEach((col, idx) => {
        if (!numericColumns[idx]) return;
        for (const cell of col.cells) {
          cell.properties = cell.properties ?? {};
          if (hasExplicitAlignment(cell.properties)) continue;
          appendClass(cell.properties, RIGHT_ALIGN_CLASS);
        }
      });

      // And to the matching header cells in thead (so the column header
      // reads aligned with the data).
      const thead = findChildElement(node, 'thead');
      if (thead) {
        for (const headerRow of eachRow(thead)) {
          const headerCells = eachCell(headerRow);
          headerCells.forEach((cell, idx) => {
            if (!numericColumns[idx]) return;
            cell.properties = cell.properties ?? {};
            if (hasExplicitAlignment(cell.properties)) return;
            appendClass(cell.properties, RIGHT_ALIGN_CLASS);
          });
        }
      }
    });
  };
}
