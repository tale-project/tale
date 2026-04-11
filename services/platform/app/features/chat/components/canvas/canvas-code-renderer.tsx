'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { extractShikiCodeContent, highlightCode } from '@/lib/utils/shiki';

interface CanvasCodeRendererProps {
  code: string;
  language?: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function CanvasCodeRendererComponent({
  code,
  language = 'plaintext',
  isEditing,
  onContentChange,
}: CanvasCodeRendererProps) {
  const [html, setHtml] = useState('');
  const { resolvedTheme } = useTheme();
  const { t } = useT('chat');
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    const delay = isEditing ? 150 : 0;
    const timeout = setTimeout(() => {
      void highlightCode(code, language, shikiTheme).then((result) => {
        if (!cancelled && result) {
          setHtml(extractShikiCodeContent(result));
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [code, language, shikiTheme, isEditing]);

  const handleScroll = useCallback(() => {
    if (!textareaRef.current || !preRef.current) return;
    requestAnimationFrame(() => {
      if (!textareaRef.current || !preRef.current) return;
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const { selectionStart, selectionEnd } = textarea;
        const indent = '  ';
        const newValue =
          code.slice(0, selectionStart) + indent + code.slice(selectionEnd);
        onContentChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = selectionStart + indent.length;
          textarea.selectionEnd = selectionStart + indent.length;
        });
      }
    },
    [code, onContentChange],
  );

  if (isEditing) {
    return (
      <div className="relative h-full overflow-hidden">
        <pre
          ref={preRef}
          className="code-line-numbers code-editor-surface bg-muted pointer-events-none absolute inset-0 overflow-auto p-4"
          aria-hidden="true"
        >
          <code
            className="code-editor-surface"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onContentChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          className={cn(
            'code-editor-surface',
            'absolute inset-0 h-full w-full resize-none bg-transparent py-4 pr-4 pl-[4rem]',
            'text-transparent caret-foreground selection:bg-accent/30',
            'focus:outline-none',
          )}
          spellCheck={false}
          style={{ caretColor: 'var(--foreground)' }}
          aria-label={t('canvas.codeEditor')}
        />
      </div>
    );
  }

  if (!html) {
    return (
      <div className="code-line-numbers code-line-hover h-full overflow-auto">
        <pre className="bg-muted p-4">
          <code className="code-editor-surface">{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="code-line-numbers code-line-hover h-full overflow-auto">
      <pre className="bg-muted p-4">
        <code
          className="code-editor-surface"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}

export const CanvasCodeRenderer = memo(CanvasCodeRendererComponent);
