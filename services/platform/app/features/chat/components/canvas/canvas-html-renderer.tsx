'use client';

import { memo, useMemo } from 'react';

import { cn } from '@/lib/utils/cn';

interface CanvasHtmlRendererProps {
  html: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function CanvasHtmlRendererComponent({
  html,
  isEditing,
  onContentChange,
}: CanvasHtmlRendererProps) {
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

  if (isEditing) {
    return (
      <textarea
        value={html}
        onChange={(e) => onContentChange(e.target.value)}
        className={cn(
          'bg-muted text-foreground h-full w-full resize-none p-4 font-mono text-xs leading-relaxed',
          'focus:outline-none',
        )}
        spellCheck={false}
        aria-label="HTML editor"
      />
    );
  }

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
