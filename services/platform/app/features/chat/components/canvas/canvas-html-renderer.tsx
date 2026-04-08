'use client';

import { memo, useMemo } from 'react';

interface CanvasHtmlRendererProps {
  html: string;
}

function CanvasHtmlRendererComponent({ html }: CanvasHtmlRendererProps) {
  const srcDoc = useMemo(
    () =>
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; color: #1a1a1a; }
  </style>
</head>
<body>${html}</body>
</html>`,
    [html],
  );

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="HTML preview"
      className="h-full w-full border-0 bg-white"
    />
  );
}

export const CanvasHtmlRenderer = memo(CanvasHtmlRendererComponent);
