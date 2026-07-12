'use client';

import { Row } from '@tale/ui/layout';
import DOMPurify from 'dompurify';
import type { UponSanitizeAttributeHook } from 'dompurify';
import { memo, useMemo } from 'react';

interface SvgViewerProps {
  svg: string;
}

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
 * Inline SVG with the minimum hardening we want before dropping arbitrary
 * markup into the DOM. The thread workspace is per-org and the file's bytes
 * already passed through the agent tool path (which only accepts
 * text/svg+xml content), so this is defence-in-depth rather than the primary
 * boundary — but it must be a real sanitizer, not a regex: a hand-rolled
 * `on\w+=` strip missed `<svg/onload=…>` (no leading space before the
 * attribute) and unquoted `href="javascript:…"`. DOMPurify's `svg` +
 * `svgFilters` profiles parse the markup as a DOM tree, so attribute syntax
 * variants can't slip past it the way a regex can (#2662).
 *
 * The `svg`/`svgFilters` profiles alone also drop legitimate diagram markup:
 * mermaid-style labels render as `<foreignObject><div>…</div></foreignObject>`,
 * and `<use>` is the standard way to reuse a `<defs>` shape — both tags are
 * absent from those profiles for security reasons (see hook above). Re-admit
 * them via `html` + `ADD_TAGS`, mark `foreignObject` as an HTML integration
 * point (per DOMPurify's own docs) so its HTML children are sanitized rather
 * than dropped wholesale, and use the hook to keep `<use>`'s href safe. Every
 * choice here is verified empirically against dompurify@3.4.11 in
 * svg-viewer.test.tsx: onload/javascript: vectors, use/xlink:href pointed at
 * javascript:, data:, or an external origin, and foreignObject-borne
 * `<script>`/`onerror`/`<iframe>` all still get stripped. Same library
 * already used for `message-editor` / `email-preview` (email-preview follows
 * the same add-hook-then-remove-it pattern below).
 */
function sanitizeSvg(input: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', restrictUseHrefToFragment);
  const safe = DOMPurify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['use', 'foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
  DOMPurify.removeHook('uponSanitizeAttribute');
  return safe;
}

function SvgViewerComponent({ svg }: SvgViewerProps) {
  const safe = useMemo(() => sanitizeSvg(svg), [svg]);
  return (
    <Row gap={0} justify="center" className="h-full w-full overflow-auto p-4">
      <div
        className="max-h-full max-w-full [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:max-w-full"
        // eslint-disable-next-line react/no-danger -- sanitized above
        // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- `safe` is sanitizeSvg() output
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </Row>
  );
}

export const SvgViewer = memo(SvgViewerComponent);
