'use client';

import { CopyIcon, CheckIcon, PanelRight } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  ReactNode,
  useCallback,
  useRef,
  useState,
  useEffect,
  memo,
} from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { highlightCode } from '@/lib/utils/shiki';

import {
  useCanvasOptional,
  type CanvasContentType,
} from '../canvas/canvas-context';
import { useMessageContentOptional } from './message-content-context';

function resolveCanvasType(language?: string): CanvasContentType {
  if (!language) return 'code';
  const lower = language.toLowerCase();
  if (lower === 'html' || lower === 'htm') return 'html';
  if (lower === 'svg') return 'svg';
  if (lower === 'mermaid' || lower === 'mmd') return 'mermaid';
  if (lower === 'markdown' || lower === 'md') return 'markdown';
  return 'code';
}

/**
 * Extract the inner HTML from Shiki's codeToHtml output.
 * Shiki wraps output in `<pre class="shiki ..."><code>...tokens...</code></pre>`.
 * Since we're already inside a `<pre>` from react-markdown's CodeBlock,
 * we extract only the inner content of the `<code>` element.
 */
function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

/** Debounce delay for Shiki highlighting. During streaming, code changes
 * every ~50ms so the timer resets each time and highlighting never fires.
 * After streaming ends, 150ms of stability triggers one clean highlight. */
const HIGHLIGHT_DEBOUNCE_MS = 150;

export const HighlightedCode = memo(function HighlightedCode({
  lang,
  code,
}: {
  lang: string;
  code: string;
}) {
  const [html, setHtml] = useState('');
  const highlightedForRef = useRef('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      void highlightCode(code, lang, shikiTheme).then((result) => {
        if (!cancelled && result) {
          highlightedForRef.current = code;
          setHtml(extractShikiCodeContent(result));
        }
      });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [code, lang, shikiTheme]);

  if (!html || highlightedForRef.current !== code) {
    return <code>{code}</code>;
  }

  return <code dangerouslySetInnerHTML={{ __html: html }} />;
});

export function CodeBlock({
  lang,
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { lang?: string; children?: ReactNode }) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const [isCopied, setIsCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const canvasContext = useCanvasOptional();
  const messageContext = useMessageContentOptional();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const textContent = preRef.current?.textContent ?? '';

    try {
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  const handleOpenInCanvas = useCallback(() => {
    if (!canvasContext) return;
    const textContent = preRef.current?.textContent ?? '';
    const canvasType = resolveCanvasType(lang);
    canvasContext.openCanvas(
      textContent,
      canvasType,
      lang ?? 'code',
      lang,
      messageContext
        ? {
            messageId: messageContext.messageId,
            messageContent: messageContext.messageContent,
            threadId: messageContext.threadId,
          }
        : undefined,
    );
  }, [canvasContext, lang, messageContext]);

  return (
    <div className="border-border bg-background my-4 w-full overflow-hidden rounded-lg border">
      <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-muted-foreground font-sans text-xs">
          {lang ?? 'code'}
        </span>
        <div className="flex items-center gap-1">
          {canvasContext && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-auto gap-1.5 rounded-md px-2 py-1 text-xs"
              onClick={handleOpenInCanvas}
              aria-label={tChat('canvas.openInCanvas')}
            >
              <PanelRight className="size-3.5" />
              {tChat('canvas.openInCanvas')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto gap-1.5 rounded-md px-2 py-1 text-xs"
            onClick={handleCopy}
          >
            {isCopied ? (
              <CheckIcon className="text-success size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {isCopied ? t('actions.copied') : t('actions.copy')}
          </Button>
        </div>
      </div>
      <pre
        ref={preRef}
        {...props}
        className="bg-muted max-h-[480px] overflow-auto p-4"
      >
        {children}
      </pre>
    </div>
  );
}
