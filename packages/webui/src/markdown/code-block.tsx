import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { highlightCode } from './shiki';

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Optional filename label rendered above the block. */
  filename?: string;
  /** Hide the copy button (e.g. inside CodeGroup tabs). */
  hideCopy?: boolean;
  className?: string;
}

const LINE_NUMBER_THRESHOLD = 3;

/**
 * Add per-line background tints to Shiki's diff output. Shiki wraps each
 * source line in `<span class="line">…</span>`; we tag those whose first
 * visible character is `+` or `-` so CSS can paint the whole row. Using
 * opacity-based backgrounds keeps the rendering legible in both themes.
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
  // Promote the .line spans to block layout so the bg fills the row width.
  // We do this via a wrapping <pre> rule injected by the consumer's CSS;
  // here we just mark the container so styles can target it.
  const pre = doc.querySelector('pre');
  if (pre) pre.classList.add('shiki-diff');
  return doc.body.innerHTML;
}

function countLines(code: string): number {
  // Trim the trailing newline most fenced blocks carry so an N-line block
  // doesn't render as N+1 numbers.
  const normalised = code.endsWith('\n') ? code.slice(0, -1) : code;
  return normalised.split('\n').length;
}

/**
 * Highlighted, copy-friendly code block. Falls back to a plain `<pre>`
 * while Shiki loads in the background so the layout never shifts.
 *
 * The copy button lives in the header bar (always rendered) so single-line
 * blocks don't reflow when the button mounts. Line numbers appear for
 * blocks with more than three lines — small snippets stay clean.
 */
export function CodeBlock({
  code,
  language,
  filename,
  hideCopy,
  className,
}: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, language, resolvedTheme).then((result) => {
      if (cancelled) return;
      setHtml(
        result.language === 'diff'
          ? applyDiffLineBackgrounds(result.html)
          : result.html,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, resolvedTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[code-block] clipboard write failed', error);
    }
  };

  const lineCount = useMemo(() => countLines(code), [code]);
  const showLineNumbers = lineCount > LINE_NUMBER_THRESHOLD;
  const lineNumbers = useMemo(
    () =>
      showLineNumbers
        ? Array.from({ length: lineCount }, (_, i) => i + 1)
        : null,
    [lineCount, showLineNumbers],
  );

  // Always render the header bar so the layout doesn't shift between
  // labelled and bare blocks. The label slot collapses to whitespace when
  // we have neither a filename nor a language tag.
  const showHeader = true;
  const headerLabel = filename ?? language ?? '';

  return (
    <div
      className={cn(
        'group/code-block border-border-base bg-bg-elevated relative my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      {showHeader ? (
        <div className="border-border-base flex h-9 items-center justify-between gap-4 border-b px-3 text-xs">
          <span className="text-fg-muted truncate font-mono">
            {headerLabel}
            {language && filename ? (
              <span className="ml-2 opacity-60">{language}</span>
            ) : null}
          </span>
          {hideCopy ? null : (
            <button
              type="button"
              onClick={handleCopy}
              disabled={copied}
              aria-label={copied ? 'Copied' : 'Copy code'}
              aria-live="polite"
              // Fixed footprint so the icon swap doesn't reflow surrounding
              // chrome. The label is announced via aria-label for SR users.
              className={cn(
                'text-fg-muted hover:text-fg-base hover:bg-bg-base/60 inline-flex size-7 shrink-0 items-center justify-center rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20',
                copied && 'text-emerald-600',
              )}
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </button>
          )}
        </div>
      ) : null}
      <div className="relative">
        <div className="flex">
          {showLineNumbers && lineNumbers ? (
            <div
              aria-hidden
              className="border-border-base text-fg-subtle bg-bg-elevated/40 border-r px-3 py-4 text-right font-mono text-xs leading-[1.6] select-none"
            >
              {lineNumbers.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          ) : null}
          {html ? (
            <div
              className="min-w-0 flex-1 overflow-x-auto p-4 text-sm [&_.shiki-diff_.line]:-mx-4 [&_.shiki-diff_.line]:inline-block [&_.shiki-diff_.line]:w-[calc(100%+2rem)] [&_.shiki-diff_.line]:px-4 [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-0 [&>pre>code>.line]:leading-[1.6]"
              // oxlint-disable-next-line react/no-danger -- Shiki output is HTML by design
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="min-w-0 flex-1 overflow-x-auto p-4 text-sm leading-[1.6]">
              <code>{code}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
