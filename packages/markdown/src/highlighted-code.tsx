import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { highlightCode } from './shiki';

const LINE_NUMBER_THRESHOLD = 3;

interface HighlightedCodeProps {
  /** Source string. A single trailing newline is normalised away so the
   * gutter count matches Shiki's emitted `<span class="line">` rows. */
  code: string;
  language?: string;
  /** Force-show line numbers regardless of length. Defaults to auto
   * (lines > 3). Set false to suppress the gutter for short snippets. */
  showLineNumbers?: boolean;
  /** Render a hover-revealed copy button anchored to the top-right. */
  showCopyButton?: boolean;
  className?: string;
}

/**
 * Add per-line background tints to Shiki's diff output. Shiki wraps each
 * source line in `<span class="line">…</span>`; we tag those whose first
 * visible character is `+` or `-` so CSS can paint the whole row.
 */
function applyDiffLineBackgrounds(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines = doc.querySelectorAll<HTMLElement>('.line');
  for (const line of lines) {
    const first = line.textContent?.[0];
    if (first === '+') {
      line.classList.add('diff-add', 'bg-green-500/15', 'dark:bg-green-500/10');
    } else if (first === '-') {
      line.classList.add('diff-del', 'bg-red-500/15', 'dark:bg-red-500/10');
    }
  }
  const pre = doc.querySelector('pre');
  if (pre) pre.classList.add('shiki-diff');
  return doc.body.innerHTML;
}

/**
 * Highlighted code body — the inner panel shared by `<CodeBlock>` and
 * each `<CodeGroup>` tab. Owns the Shiki call, line-number toggle, diff
 * tints, row-hover affordance, and (optionally) an inline copy button.
 *
 * Falls back to a plain `<pre>` while Shiki loads so layout never shifts.
 */
export function HighlightedCode({
  code,
  language,
  showLineNumbers,
  showCopyButton,
  className,
}: HighlightedCodeProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Strip the trailing newline most fenced blocks carry. Both the gutter
  // count and Shiki must tokenise the same string — otherwise Shiki emits
  // an extra `<span class="line">` for the trailing newline while the
  // gutter generates one fewer number, and the last visible row has no
  // line number.
  const normalisedCode = useMemo(
    () => (code.endsWith('\n') ? code.slice(0, -1) : code),
    [code],
  );

  useEffect(() => {
    let cancelled = false;
    void highlightCode(normalisedCode, language, resolvedTheme).then(
      (result) => {
        if (cancelled) return;
        if (!result) {
          // Oversized input or highlighter init failure — drop the cached
          // html so the plain `<pre>` fallback renders the new source.
          setHtml(null);
          return;
        }
        setHtml(
          result.language === 'diff'
            ? applyDiffLineBackgrounds(result.html)
            : result.html,
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [normalisedCode, language, resolvedTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(normalisedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[code-block] clipboard write failed', error);
    }
  };

  const lineCount = useMemo(
    () => normalisedCode.split('\n').length,
    [normalisedCode],
  );
  const numbered = showLineNumbers ?? lineCount > LINE_NUMBER_THRESHOLD;

  return (
    <div className={cn('group/highlighted-code relative', className)}>
      {showCopyButton ? (
        <button
          type="button"
          onClick={handleCopy}
          disabled={copied}
          aria-label={copied ? 'Copied' : 'Copy code'}
          aria-live="polite"
          className={cn(
            'text-fg-muted hover:text-fg-base hover:bg-bg-elevated/80 absolute top-2 right-2 z-10 inline-flex size-7 items-center justify-center rounded transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20',
            'opacity-0 group-hover/highlighted-code:opacity-100 focus-visible:opacity-100',
            copied && 'text-emerald-600 opacity-100 dark:text-emerald-400',
          )}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      ) : null}
      {html ? (
        <div
          className={cn(
            // The outer wrapper owns the background; Shiki's per-pre bg is
            // forced transparent so the same surface reaches every edge —
            // no visible double-padding ring.
            '[&_.line:hover]:bg-fg-base/[0.04] overflow-x-auto p-4 text-sm [&_.line]:-mx-4 [&_.line]:inline-block [&_.line]:w-[calc(100%+2rem)] [&_.line]:px-4 [&_.line]:transition-colors [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-0 [&>pre>code>.line]:leading-[1.6]',
            showCopyButton && 'pr-12',
            numbered && 'code-block-numbered',
          )}
          // oxlint-disable-next-line react/no-danger -- Shiki output is HTML by design
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cn(
            'overflow-x-auto p-4 text-sm leading-[1.6]',
            showCopyButton && 'pr-12',
          )}
        >
          <code>{normalisedCode}</code>
        </pre>
      )}
    </div>
  );
}
