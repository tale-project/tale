import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

interface PageActionsProps {
  /** Absolute URL of the canonical HTML page. */
  pageUrl: string;
  /** Absolute URL of the `.md` version (usually `pageUrl + '.md'`). */
  markdownUrl: string;
  /** Raw markdown to copy when "Copy page" is clicked. Pass null to disable that action. */
  markdown: string | null;
  className?: string;
  /** Override translatable labels (defaults are English). */
  labels?: Partial<{
    copyPage: string;
    copied: string;
    viewMarkdown: string;
    openIn: string;
    openChatGpt: string;
    openClaude: string;
    openCursor: string;
  }>;
}

const DEFAULT_LABELS = {
  copyPage: 'Copy page',
  copied: 'Copied',
  viewMarkdown: 'View as Markdown',
  openIn: 'Open in',
  openChatGpt: 'Open in ChatGPT',
  openClaude: 'Open in Claude',
  openCursor: 'Open in Cursor',
};

function chatGptUrl(markdownUrl: string): string {
  return `https://chatgpt.com/?hints=search&q=${encodeURIComponent(`Read ${markdownUrl} and answer my questions.`)}`;
}
function claudeUrl(markdownUrl: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(`Read ${markdownUrl} and answer my questions.`)}`;
}
function cursorUrl(markdownUrl: string): string {
  // Cursor's built-in /docs ingester accepts pages via the cursor:// deeplink
  // scheme.
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(`Use ${markdownUrl} as documentation context.`)}`;
}

export function PageActions({
  pageUrl: _pageUrl,
  markdownUrl,
  markdown,
  className,
  labels: labelOverrides,
}: PageActionsProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleCopy = async () => {
    if (markdown === null) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[page-actions] clipboard write failed', error);
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-flex items-center gap-1', className)}
    >
      {markdown !== null ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          aria-label={copied ? labels.copied : labels.copyPage}
          className="min-w-34 justify-center gap-1.5"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          <span aria-live="polite">
            {copied ? labels.copied : labels.copyPage}
          </span>
        </Button>
      ) : null}
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        <Bot className="size-3.5" aria-hidden />
        <span>{labels.openIn}</span>
        <ChevronDown className="size-3" aria-hidden />
      </Button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          className="border-border-base bg-bg-base absolute top-full right-0 z-30 mt-2 flex min-w-[220px] flex-col overflow-hidden rounded-md border py-1 text-sm shadow-lg"
        >
          <li>
            <a
              role="menuitem"
              href={markdownUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="text-fg-muted hover:bg-bg-elevated hover:text-fg-base flex items-center gap-2 px-3 py-2 transition-colors"
            >
              <FileText className="size-3.5" aria-hidden />
              {labels.viewMarkdown}
            </a>
          </li>
          <li>
            <a
              role="menuitem"
              href={chatGptUrl(markdownUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="text-fg-muted hover:bg-bg-elevated hover:text-fg-base flex items-center gap-2 px-3 py-2 transition-colors"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {labels.openChatGpt}
            </a>
          </li>
          <li>
            <a
              role="menuitem"
              href={claudeUrl(markdownUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="text-fg-muted hover:bg-bg-elevated hover:text-fg-base flex items-center gap-2 px-3 py-2 transition-colors"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {labels.openClaude}
            </a>
          </li>
          <li>
            <a
              role="menuitem"
              href={cursorUrl(markdownUrl)}
              onClick={() => setOpen(false)}
              className="text-fg-muted hover:bg-bg-elevated hover:text-fg-base flex items-center gap-2 px-3 py-2 transition-colors"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {labels.openCursor}
            </a>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
