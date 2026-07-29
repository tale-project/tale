'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { useTheme } from '@tale/ui/theme';
import { CheckIcon, CopyIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { memo, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { highlightCode } from '@/lib/utils/shiki';

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

/**
 * Split code into lines, keeping each newline attached to its line so the
 * concatenated chunks reproduce the input exactly. Each line renders as a
 * `.stream-seg` span: inside the streaming portion (`.stream-reveal`) a newly
 * arrived line fades in (line-by-line reveal); outside it the spans are
 * inert markup with identical layout (`<pre>` preserves the whitespace).
 */
function splitCodeLines(code: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') {
      lines.push(code.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < code.length) lines.push(code.slice(start));
  return lines;
}

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
          setHtml(extractShikiCodeContent(result.html));
        }
      });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [code, lang, shikiTheme]);

  if (!html || highlightedForRef.current !== code) {
    // Un-highlighted fallback (highlight is debounced while streaming):
    // line-keyed spans so each newly streamed line mounts fresh and fades in
    // via the `.stream-reveal` mount animation. Index keys are stable —
    // streamed code only ever appends lines.
    return (
      <code>
        {splitCodeLines(code).map((line, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- lines only append during streaming; index identity is stable
          <span key={i} className="stream-seg">
            {line}
          </span>
        ))}
      </code>
    );
  }

  return (
    // oxlint-disable-next-line react/no-danger -- Shiki output is HTML by design
    // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- `html` is Shiki highlighter output (code text HTML-escaped by Shiki); not untrusted markup
    <code dangerouslySetInnerHTML={{ __html: html }} />
  );
});

/** Pixel tolerance for considering the pre "at the bottom". Accounts for
 * sub-pixel rounding and lets the user be a few px off and still auto-follow. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

export function CodeBlock({
  lang,
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { lang?: string; children?: ReactNode }) {
  const { t } = useT('common');
  const [isCopied, setIsCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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

  // Follow growth one frame at a time: reveal ticks arrive at animation
  // rate, and an unconditional scrollTop write per tick forces layout every
  // time — coalescing into a single rAF keeps the follow at frame cost.
  const followRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (followRafRef.current !== null) {
        cancelAnimationFrame(followRafRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const pre = preRef.current;
    if (!pre || !stickToBottomRef.current) return;
    if (pre.scrollHeight <= pre.clientHeight) return;
    if (followRafRef.current !== null) return;
    followRafRef.current = requestAnimationFrame(() => {
      followRafRef.current = null;
      const current = preRef.current;
      if (current && stickToBottomRef.current) {
        current.scrollTop = current.scrollHeight;
      }
    });
  }, [children]);

  const handleCopy = async () => {
    const textContent = preRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="border-border bg-background my-4 overflow-hidden rounded-lg border">
      <Row
        gap={0}
        justify="between"
        className="border-border border-b px-4 py-2.5"
      >
        <span className="text-muted-foreground font-sans text-xs">
          {lang ?? 'code'}
        </span>
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
      </Row>
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
