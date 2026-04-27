'use client';

import { memo, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode } from '@/lib/utils/shiki';

interface CanvasCodeRendererProps {
  code: string;
  language?: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

function CanvasCodeRendererComponent({
  code,
  language = 'plaintext',
  isEditing,
  onContentChange,
}: CanvasCodeRendererProps) {
  const { t } = useT('chat');
  const [html, setHtml] = useState('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) return undefined;
    let cancelled = false;
    void highlightCode(code, language, shikiTheme).then((result) => {
      if (!cancelled && result) {
        setHtml(extractShikiCodeContent(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, shikiTheme, isEditing]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(e) => onContentChange(e.target.value)}
        className={cn(
          'bg-muted text-foreground h-full w-full resize-none p-4 font-mono text-xs leading-relaxed',
          'focus:outline-none',
        )}
        spellCheck={false}
        aria-label={t('canvas.codeEditor')}
      />
    );
  }

  if (!html) {
    return (
      <pre className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">{code}</code>
      </pre>
    );
  }

  return (
    <pre className="bg-muted h-full overflow-auto p-4">
      <code
        className="text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

export const CanvasCodeRenderer = memo(CanvasCodeRendererComponent);
