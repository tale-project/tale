'use client';

import { Row } from '@tale/ui/layout';
import { memo, useMemo } from 'react';

interface SvgViewerProps {
  svg: string;
}

/**
 * Inline SVG with the minimum hardening we want before dropping arbitrary
 * markup into the DOM: strip `<script>` blocks and `on*=` attributes. The
 * thread workspace is per-org and the file's bytes already passed through
 * the agent tool path (which only accepts text/svg+xml content), so this
 * is defence-in-depth rather than the primary boundary.
 */
function sanitizeSvg(input: string): string {
  let out = input.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    '',
  );
  // Strip event handlers: on... attributes regardless of quote style. The
  // unquoted form is rare but valid HTML, so we cover all three.
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  // Strip javascript: URLs in href/xlink:href.
  out = out.replace(/\s(?:xlink:)?href\s*=\s*"javascript:[^"]*"/gi, '');
  out = out.replace(/\s(?:xlink:)?href\s*=\s*'javascript:[^']*'/gi, '');
  return out;
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
