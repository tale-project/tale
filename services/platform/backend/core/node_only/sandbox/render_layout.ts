/**
 * The rendered page's markup with its layout written in. The crawler's render
 * worker runs this INSIDE the settled page (`page.evaluate`) and hands the
 * result on as the page's HTML.
 *
 * `htmlToText` reads tags, not CSS, and lays inline formatting out the way a
 * browser does: without a space. What only the page's CSS separates — spans
 * laid out as flex or grid items, as blocks, as inline blocks — would
 * otherwise run together. So each element's computed `display` is written
 * into the markup here: a newline around every element laid out as a block
 * box (flex and grid items are blockified, so they count), a space around
 * every inline-level box and table cell. A plain inline element gets nothing,
 * which is what keeps a word a script split into one `<span>` per letter a
 * word.
 *
 * The live page is never modified: the walk reads the live document and
 * writes a copy, which is what gets serialized.
 *
 * Self-contained on purpose: the worker ships this function's source text
 * into the page, so its body may reference nothing but its argument and the
 * page's own globals.
 */
function renderedLayoutHtml(doc: Document): string {
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
    } else if (display.startsWith('inline-') || display === 'table-cell') {
      separators.push([written, ' ']);
    }
    live = liveWalk.nextNode();
    written = copyWalk.nextNode();
  }
  for (const [element, separator] of separators) {
    element.before(separator);
    element.after(separator);
  }
  return `<!DOCTYPE html>${copy.outerHTML}`;
}

/** What the render worker evaluates in a settled page for its HTML. */
export const RENDERED_LAYOUT_SCRIPT = `(${renderedLayoutHtml.toString()})(document)`;
