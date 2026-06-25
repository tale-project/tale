'use client';

import { useTheme } from '@tale/ui/theme';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils/cn';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import { getFileExtensionLower } from '@/lib/utils/text-file-types';

interface CodeViewerProps {
  /** File path — used to resolve the syntax highlighter language. */
  path: string;
  /** Decoded text content. */
  content: string;
  /** Optional override; otherwise inferred from the path extension. */
  language?: string;
  /** When true, long lines wrap instead of scrolling horizontally. */
  wrap?: boolean;
  className?: string;
}

const OVERSIZE_BYTES = 64_000;

// Debounce for re-highlighting while content keeps changing (streaming
// `file_write`). The first highlight of a freshly-opened file skips this.
const STREAM_DEBOUNCE_MS = 80;

// Shell for shiki's highlighted output. `bg-transparent!` overrides the inline
// theme background shiki bakes into its `<pre>` so the canvas background shows
// through in both the fallback and highlighted states (same pattern as the
// document text preview) — otherwise a coloured box pops in when highlighting
// lands. `p-4!` plus the `.line::before` gutter from `code-line-numbers` puts
// the first glyph at 1rem (padding) + 3rem (2rem gutter + 1rem margin) = 4rem.
const SHIKI_SHELL =
  'code-line-numbers text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:bg-transparent! [&_pre]:p-4!';
const WRAP_ON = '[&_pre]:break-words [&_pre]:whitespace-pre-wrap';
const WRAP_OFF = '[&_pre]:overflow-auto';

// Left padding for the un-highlighted fallback. Matches the 4rem the shiki
// output reserves (1rem `<pre>` padding + the 3rem `code-line-numbers` gutter,
// see globals.css `.code-line-numbers .line::before`) so the text sits at the
// exact x-position it will keep once highlighting lands — no horizontal jump.
const FALLBACK_PRE =
  'm-0 py-4 pr-4 pl-16 text-foreground text-xs leading-relaxed';

/**
 * Syntax-highlighted code preview. A pure content renderer: it owns the shiki
 * highlighting, the oversize cutoff, and the plaintext fallback, but no chrome.
 * The `wrap` state and the action card live in the surrounding viewer
 * (`code-file-viewer.tsx` for code files, `renderable-file-viewer.tsx` for the
 * source view of markdown/html/svg/mermaid), so every canvas variant shares one
 * floating action surface. Tab handling intentionally stays simple (no
 * scrolling-to-line, no diff gutters) — the canvas needs a viewer, not an editor.
 */
function CodeViewerComponent({
  path,
  content,
  language,
  wrap = false,
  className,
}: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const lastHighlightedRef = useRef<string | null>(null);

  const ext = getFileExtensionLower(path);
  const resolvedLang = language ?? resolveLanguage(ext);
  const oversize = content.length > OVERSIZE_BYTES;

  // A hard swap to the plaintext fallback is fine when the viewer switches
  // to a different file, but doing it on every streaming chunk produces the
  // colored↔plaintext flicker the user sees.
  useEffect(() => {
    setHighlightedHtml(null);
    lastHighlightedRef.current = null;
  }, [path, resolvedLang]);

  useEffect(() => {
    if (!content || oversize) {
      if (oversize) {
        setHighlightedHtml(null);
        lastHighlightedRef.current = null;
      }
      return undefined;
    }
    if (lastHighlightedRef.current === content) return undefined;
    let cancelled = false;
    // The first highlight after opening a file runs immediately — with shiki
    // preloaded (see `preloadHighlighter` on canvas mount) it resolves in a
    // frame or two, so static opens colorize right away instead of sitting in
    // the plaintext fallback for 80ms. The debounce only applies to subsequent
    // updates (streaming `file_write` chunks), where re-highlighting every
    // delta would thrash and flicker.
    const delayMs =
      lastHighlightedRef.current === null ? 0 : STREAM_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      void highlightCode(content, resolvedLang, shikiTheme).then((result) => {
        if (cancelled) return;
        lastHighlightedRef.current = content;
        setHighlightedHtml(result?.html ?? null);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, resolvedLang, oversize, shikiTheme]);

  const highlightRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && highlightedHtml) el.innerHTML = highlightedHtml;
    },
    [highlightedHtml],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        {oversize ? (
          <pre
            className={cn(
              'm-0 p-4',
              wrap ? 'break-words whitespace-pre-wrap' : 'overflow-auto',
            )}
          >
            <code className="text-foreground font-mono text-xs leading-relaxed">
              {content}
            </code>
          </pre>
        ) : highlightedHtml ? (
          <div
            ref={highlightRef}
            className={cn(SHIKI_SHELL, wrap ? WRAP_ON : WRAP_OFF)}
          />
        ) : (
          // Pre-highlight fallback. A plain `<pre>` handles line breaks itself,
          // so there's no shiki DOM to mirror; the left padding reserves the
          // gutter width and the transparent background matches `SHIKI_SHELL`,
          // so when highlighting lands only the colours (and line numbers) fill
          // in — the text never moves.
          <pre
            className={cn(
              FALLBACK_PRE,
              wrap ? 'break-words whitespace-pre-wrap' : 'overflow-auto',
            )}
          >
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

export const CodeViewer = memo(CodeViewerComponent);
