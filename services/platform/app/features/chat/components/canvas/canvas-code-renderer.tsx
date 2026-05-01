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
  /** True only while the LLM is actively appending tokens (create/rewrite).
   * Drives the trailing caret and stick-to-bottom; patch streams keep this
   * false because the source is unchanged during the stream window. */
  isStreaming?: boolean;
  onContentChange: (content: string) => void;
}

/** Pixel tolerance for considering the pre "at the bottom". Mirrors the
 * inline code-block in message-bubble so the two feel consistent. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

function CanvasCodeRendererComponent({
  code,
  language = 'plaintext',
  isEditing,
  isStreaming = false,
  onContentChange,
}: CanvasCodeRendererProps) {
  const { t } = useT('chat');
  const [html, setHtml] = useState('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

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

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return undefined;
    const onScroll = () => {
      const distanceFromBottom =
        pre.scrollHeight - pre.scrollTop - pre.clientHeight;
      stickToBottomRef.current =
        distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };
    pre.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      pre.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Auto-follow the trailing edge while content grows. If the user scrolls
  // up to read earlier output, stickToBottomRef goes false and we leave them
  // alone until they scroll back near the bottom.
  useEffect(() => {
    const pre = preRef.current;
    if (pre && stickToBottomRef.current) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [code, html]);

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

  const caret = isStreaming ? (
    <span
      aria-hidden="true"
      className="bg-foreground/80 ml-0.5 inline-block h-3 w-[2px] animate-pulse align-middle"
    />
  ) : null;

  if (!html) {
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          {code}
          {caret}
        </code>
      </pre>
    );
  }

  return (
    <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
      <code className="text-xs leading-relaxed">
        <span dangerouslySetInnerHTML={{ __html: html }} />
        {caret}
      </code>
    </pre>
  );
}

export const CanvasCodeRenderer = memo(CanvasCodeRendererComponent);
