/**
 * Mammoth and the ODT converter can preserve Word/LibreOffice layout styles
 * (`position: absolute`, fixed heights on wrapper divs) that made sense on a
 * printed page but collapse the in-app preview: the white page shell sizes to
 * the in-flow table while body text paints on the grey canvas below. Strip
 * those layout-only styles before the HTML is injected into the page shell.
 */
const OUT_OF_FLOW_PROPS = [
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'z-index',
] as const;

const FLOW_WRAPPER_TAGS = new Set(['div', 'section', 'article']);

const FLOW_WRAPPER_HEIGHT_PROPS = [
  'height',
  'max-height',
  'min-height',
] as const;

export function normalizeConvertedDocumentHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const el of doc.body.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }

    for (const prop of OUT_OF_FLOW_PROPS) {
      el.style.removeProperty(prop);
    }

    if (!FLOW_WRAPPER_TAGS.has(el.tagName.toLowerCase())) {
      continue;
    }

    for (const prop of FLOW_WRAPPER_HEIGHT_PROPS) {
      el.style.removeProperty(prop);
    }

    // Word wrappers sometimes clip the next section instead of growing the page.
    if (el.style.overflow === 'hidden' || el.style.overflow === 'clip') {
      el.style.removeProperty('overflow');
    }
  }

  return doc.body.innerHTML;
}
