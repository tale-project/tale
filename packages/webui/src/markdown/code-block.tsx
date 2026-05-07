import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

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

/**
 * Highlighted, copy-friendly code block. Falls back to a plain `<pre>`
 * while Shiki loads in the background so the layout never shifts.
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

  return (
    <div
      className={cn(
        'group/code-block border-border-base bg-bg-elevated relative my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      {filename || language ? (
        <div className="border-border-base text-fg-muted flex items-center justify-between border-b px-4 py-2 text-xs">
          <span className="truncate font-mono">{filename ?? language}</span>
          {language && filename ? (
            <span className="font-mono opacity-60">{language}</span>
          ) : null}
        </div>
      ) : null}
      <div className="relative">
        {hideCopy ? null : (
          <button
            type="button"
            onClick={handleCopy}
            disabled={copied}
            aria-label={copied ? 'Copied' : 'Copy code'}
            aria-live="polite"
            // The button stays visible at low opacity so the affordance is
            // discoverable on touch devices, then ramps to full opacity on
            // hover/focus or once the user has just copied.
            className={cn(
              'border-border-base bg-bg-base text-fg-muted absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border opacity-60 shadow-sm transition focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20',
              'hover:text-fg-base group-hover/code-block:opacity-100',
              copied && 'cursor-default text-emerald-600 opacity-100',
            )}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
          </button>
        )}
        {html ? (
          <div
            className="overflow-x-auto p-4 text-sm [&_.shiki-diff_.line]:-mx-4 [&_.shiki-diff_.line]:inline-block [&_.shiki-diff_.line]:w-[calc(100%+2rem)] [&_.shiki-diff_.line]:px-4 [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-0"
            // oxlint-disable-next-line react/no-danger -- Shiki output is HTML by design
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="overflow-x-auto p-4 text-sm">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
