'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { useT } from '@tale/ui/i18n/client';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useState } from 'react';

export interface PageActionsProps {
  /** Absolute URL of the page's plain-markdown twin (`<page>.md`). */
  markdownUrl: string;
  /** Raw markdown "Copy page" puts on the clipboard. `null` hides the action. */
  markdown: string | null;
  className?: string;
}

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
 * The header strip's page actions: copy the page as markdown, or hand it to a
 * model. The menu is the shared `DropdownMenu`, so it behaves like every
 * other menu in the app — Radix roving focus, Esc closes and returns focus to
 * the trigger, click-outside dismisses.
 */
export function PageActions({
  markdownUrl,
  markdown,
  className,
}: PageActionsProps) {
  const { t } = useT('docs');
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

  const copyLabel = copied
    ? t('pageActions.copied')
    : t('pageActions.copyPage');

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      {markdown !== null ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={copied ? Check : Copy}
          onClick={handleCopy}
          aria-label={copyLabel}
          className="min-w-34 justify-center"
        >
          <span aria-live="polite">{copyLabel}</span>
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
            aria-label={t('pageActions.openIn')}
          >
            {t('pageActions.openIn')}
            <ChevronDown className="ml-2 size-3" aria-hidden />
          </Button>
        }
        items={[
          [
            {
              type: 'item',
              label: t('pageActions.viewMarkdown'),
              icon: FileText,
              href: markdownUrl,
              external: true,
            },
            {
              type: 'item',
              label: t('pageActions.openChatGpt'),
              icon: ExternalLink,
              href: chatGptUrl(markdownUrl),
              external: true,
            },
            {
              type: 'item',
              label: t('pageActions.openClaude'),
              icon: ExternalLink,
              href: claudeUrl(markdownUrl),
              external: true,
            },
            {
              type: 'item',
              label: t('pageActions.openCursor'),
              icon: ExternalLink,
              href: cursorUrl(markdownUrl),
            },
          ],
        ]}
      />
    </div>
  );
}
