import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useState } from 'react';

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

/**
 * The header row's page actions: copy the page as markdown, or hand it to a
 * model. The menu is the shared `DropdownMenu`, so it behaves like every
 * other menu in the app — Radix roving focus, Esc closes and returns focus to
 * the trigger, click-outside dismisses.
 */
export function PageActions({
  pageUrl: _pageUrl,
  markdownUrl,
  markdown,
  className,
  labels: labelOverrides,
}: PageActionsProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [copied, setCopied] = useState(false);

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
    <div className={cn('inline-flex items-center gap-1', className)}>
      {markdown !== null ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={copied ? Check : Copy}
          onClick={handleCopy}
          aria-label={copied ? labels.copied : labels.copyPage}
          className="min-w-34 justify-center"
        >
          <span aria-live="polite">
            {copied ? labels.copied : labels.copyPage}
          </span>
        </Button>
      ) : null}
      <DropdownMenu
        align="end"
        contentClassName="min-w-[13.75rem]"
        trigger={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={Bot}
            aria-label={labels.openIn}
          >
            {labels.openIn}
            <ChevronDown className="ml-2 size-3" aria-hidden />
          </Button>
        }
        items={[
          [
            {
              type: 'item',
              label: labels.viewMarkdown,
              icon: FileText,
              href: markdownUrl,
              external: true,
            },
            {
              type: 'item',
              label: labels.openChatGpt,
              icon: ExternalLink,
              href: chatGptUrl(markdownUrl),
              external: true,
            },
            {
              type: 'item',
              label: labels.openClaude,
              icon: ExternalLink,
              href: claudeUrl(markdownUrl),
              external: true,
            },
            {
              type: 'item',
              label: labels.openCursor,
              icon: ExternalLink,
              href: cursorUrl(markdownUrl),
            },
          ],
        ]}
      />
    </div>
  );
}
