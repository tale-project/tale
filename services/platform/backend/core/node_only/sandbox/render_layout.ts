import { RENDERED_LAYOUT_ATTRIBUTE } from '../../../../lib/knowledge/html-to-text';

/**
 * The rendered page's markup with its layout written in. The crawler's render
 * worker runs this INSIDE the settled page (`page.evaluate`) and hands the
 * result on as the page's HTML.
 *
 * `htmlToText` reads tags, not CSS. In markup this pass has marked it lays
 * inline formatting out the way a browser does, without a space, so what
 * only the page's CSS separates — spans laid out as flex or grid items, as
 * blocks, as inline blocks — has to reach it in the markup. Each element's
 * computed `display` is written in here: a newline around every element
 * laid out as a block box (flex and grid items are blockified, so they
 * count), a space around every other box that is not plain inline — an
 * inline block, a table cell, and an element the page hides, whose text
 * stays in the markup (the two labels of a responsive button would
 * otherwise read as one word). A plain inline element gets nothing, which
 * is what keeps a word a script split into one `<span>` per letter a word.
 *
 * The live page is never modified: the walk reads the live document and
 * writes a copy, which is what gets serialized, with `marker` set on its
 * root so the text pass knows the layout is in.
 *
 * Self-contained on purpose: the worker ships this function's source text
 * into the page, so its body may reference nothing but its arguments and
 * the page's own globals.
 */
function renderedLayoutHtml(doc: Document, marker: string): string {
  const blockDisplays = new Set([
    'block',
    'flex',
    'grid',
    'flow-root',
    'list-item',
    'table',
    'table-caption',
    'table-row',
    'table-row-group',
    'table-header-group',
    'table-footer-group',
  ]);
  const isElement = (node: Node | null): node is Element =>
    node !== null && node.nodeType === 1;
  const view = doc.defaultView;
  const root = doc.documentElement;
  const copy = root.cloneNode(true);
  if (view === null || !isElement(copy)) return '';
  // 1 === NodeFilter.SHOW_ELEMENT. A deep clone has the very same element
  // tree, so the two walks stay in step.
  const liveWalk = doc.createTreeWalker(root, 1);
  const copyWalk = doc.createTreeWalker(copy, 1);
  const separators: [Element, string][] = [];
  let live: Node | null = liveWalk.currentNode;
  let written: Node | null = copyWalk.currentNode;
  while (isElement(live) && isElement(written)) {
    const display = view.getComputedStyle(live).display;
    if (blockDisplays.has(display)) {
      separators.push([written, '\n']);
    } else if (
      display !== 'inline' &&
      display !== 'contents' &&
      !display.startsWith('ruby')
    ) {
      // Every other box stands apart from its neighbours: inline blocks,
      // table cells, `none`, and whatever this list does not name.
      separators.push([written, ' ']);
    }
    live = liveWalk.nextNode();
    written = copyWalk.nextNode();
  }
  for (const [element, separator] of separators) {
    element.before(separator);
    element.after(separator);
  }
  copy.setAttribute(marker, '1');
  return `<!DOCTYPE html>${copy.outerHTML}`;
}

/** What the render worker evaluates in a settled page for its HTML. */
export const RENDERED_LAYOUT_SCRIPT = `(${renderedLayoutHtml.toString()})(document, ${JSON.stringify(RENDERED_LAYOUT_ATTRIBUTE)})`;
