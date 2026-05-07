import { cn } from '@tale/ui/cn';
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
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, language).then((result) => {
      if (!cancelled) setHtml(result.html);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

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
            aria-label={copied ? 'Copied' : 'Copy code'}
            // The button stays visible at low opacity so the affordance is
            // discoverable on touch devices, then ramps to full opacity on
            // hover/focus or once the user has just copied.
            className={cn(
              'border-border-base bg-bg-base text-fg-muted absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border opacity-60 shadow-sm transition focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20',
              'hover:text-fg-base group-hover/code-block:opacity-100',
              copied && 'text-emerald-600 opacity-100',
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
            className="overflow-x-auto p-4 text-sm [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-0"
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
