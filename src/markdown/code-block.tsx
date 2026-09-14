import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { HighlightedCode } from './highlighted-code';

interface CodeBlockProps {
  code: string;
  language?: string;
  /** Optional filename label rendered above the block. */
  filename?: string;
  /** Hide the copy button (e.g. inside CodeGroup tabs). */
  hideCopy?: boolean;
  /** Hide the header bar (filename + copy) entirely. Useful when an outer
   * wrapper (CodeGroup, custom card) provides its own chrome. */
  hideHeader?: boolean;
  /** Force-show or hide the line-number gutter. Defaults to auto (lines > 3).
   * Set to `true` for streaming surfaces so the gutter never appears
   * mid-stream (which would shift the content rightward). */
  showLineNumbers?: boolean;
  className?: string;
}

/**
 * Highlighted, copy-friendly code block. Rendered as a bordered card with
 * an optional header bar (filename + copy button) on top and the
 * highlighted source body — the same body the CodeGroup panels render so
 * the two surfaces look identical.
 *
 * Falls back to a plain `<pre>` while Shiki loads in the background so
 * the layout never shifts.
 */
export function CodeBlock({
  code,
  language,
  filename,
  hideCopy,
  hideHeader,
  showLineNumbers,
  className,
}: CodeBlockProps) {
  const headerLabel = filename ?? language ?? '';
  return (
    <div
      className={cn(
        'border-border-base bg-bg-elevated relative my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      {hideHeader ? null : (
        <CodeBlockHeader label={headerLabel} hideCopy={hideCopy} code={code} />
      )}
      <HighlightedCode
        code={code}
        language={language}
        showLineNumbers={showLineNumbers}
        showCopyButton={hideHeader && !hideCopy}
      />
    </div>
  );
}

interface CodeBlockHeaderProps {
  label: string;
  hideCopy?: boolean;
  code: string;
}

function CodeBlockHeader({ label, hideCopy, code }: CodeBlockHeaderProps) {
  return (
    <div className="border-border-base flex h-9 items-center justify-between gap-4 border-b px-3 text-xs">
      <span className="text-fg-muted truncate font-mono">{label}</span>
      {hideCopy ? null : <HeaderCopyButton code={code} />}
    </div>
  );
}

function HeaderCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any in-flight reset timer on unmount so we never call
  // `setCopied(false)` after the component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code;
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[code-block] clipboard write failed', error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={copied}
      aria-label={copied ? 'Copied' : 'Copy code'}
      aria-live="polite"
      className={cn(
        'text-fg-muted hover:text-fg-base hover:bg-bg-base/60 inline-flex size-7 shrink-0 items-center justify-center rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20',
        copied && 'text-emerald-600 dark:text-emerald-400',
      )}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
