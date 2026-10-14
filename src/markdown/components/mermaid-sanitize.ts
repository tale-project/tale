import DOMPurify from 'dompurify';
import type { UponSanitizeAttributeHook } from 'dompurify';

// The diagram sanitizer, a module of its own so DOMPurify loads with mermaid
// (`loadMermaid` in `./mermaid.tsx`) and not with every page that renders
// markdown: the diagram is drawn, and sanitized, only after both arrive.

/**
 * DOMPurify's `svg`/`svgFilters` profiles deliberately exclude `<use>` and
 * `<foreignObject>` — both are documented mXSS/XSS vectors (`<use>`'s
 * href/xlink:href can point at a javascript:/data: URI or an external
 * origin; `<foreignObject>` is a namespace-confusion vector). Re-admitting
 * them (below) without this hook would let `<use href="javascript:…">` or
 * `<use href="https://evil/…#id">` through untouched, since ADD_TAGS only
 * controls which *tags* are kept, not attribute values. Pin `<use>` to
 * same-document fragment references only — the one legitimate use case
 * (reusing a local `<defs>` shape) — and strip anything else.
 */
const restrictUseHrefToFragment: UponSanitizeAttributeHook = (node, data) => {
  if (
    node.tagName.toLowerCase() === 'use' &&
    (data.attrName === 'href' || data.attrName === 'xlink:href') &&
    !data.attrValue.startsWith('#')
  ) {
    data.keepAttr = false;
  }
};

/**
 * Mermaid renders untrusted diagram DSL to SVG client-side and we inject the
 * result via `dangerouslySetInnerHTML` — the same defect class fixed in
 * `app/features/workspace/viewers/svg-viewer.tsx` (#2662): a hand-rolled
 * `on\w+=` regex strip is bypassable (`<svg/onload=…>` has no leading space,
 * `href=javascript:…` can be unquoted), so this must be a real sanitizer
 * that parses the markup as a DOM tree. `securityLevel: 'strict'` on
 * `mermaid.initialize` already runs the output through mermaid's own bundled
 * DOMPurify, but that's an implementation detail of a third-party dependency,
 * not a boundary this component controls — sanitize again at the point
 * where we hand the string to React, same as every other untrusted-SVG
 * sink in this codebase.
 *
 * Mermaid legitimately renders text labels as
 * `<foreignObject><div>…</div></foreignObject>`, which the plain `svg`/
 * `svgFilters` DOMPurify profiles drop entirely. Re-admit `foreignObject`
 * (and `use`, for `<defs>` shape reuse) via `html` + `ADD_TAGS`, mark
 * `foreignObject` as an HTML integration point so its HTML children are
 * sanitized rather than dropped wholesale, and use the hook above to keep
 * `<use>`'s href safe. This config is deliberately identical to
 * `sanitizeSvg` in `svg-viewer.tsx` — @tale/ui can't import from the
 * `services/platform` app (wrong dependency direction) so it can't be a
 * single shared helper; keep both copies in sync if the trade-off changes.
 */
export function sanitizeMermaidSvg(input: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', restrictUseHrefToFragment);
  const safe = DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['use', 'foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
  DOMPurify.removeHook('uponSanitizeAttribute');
  return safe;
}
