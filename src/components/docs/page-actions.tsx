'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { useT } from '@tale/ui/i18n/client';
import { useCopy } from '@tale/ui/use-copy';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
} from 'lucide-react';

export interface PageActionsProps {
  /** Absolute URL of the page's plain-markdown twin (`<page>.md`). */
  markdownUrl: string;
  /** Markdown to copy, optionally prepared only on click. `null` hides the action. */
  markdown: string | (() => string) | null;
  className?: string;
}

// Each hand-off opens the model with a prompt in the reader's language.
function chatGptUrl(prompt: string): string {
  return `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`;
}
function claudeUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
function cursorUrl(prompt: string): string {
  // Cursor's built-in /docs ingester accepts pages via the cursor:// deeplink
  // scheme.
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`;
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
  // A refused clipboard raises the shared error toast instead of failing
  // silently.
  const { copied, copy } = useCopy({ copiedDuration: 1500 });

  const handleCopy = () => {
    if (markdown === null) return;
    void copy(typeof markdown === 'function' ? markdown() : markdown);
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
              href: chatGptUrl(
                t('pageActions.promptRead', { url: markdownUrl }),
              ),
              external: true,
            },
            {
              type: 'item',
              label: t('pageActions.openClaude'),
              icon: ExternalLink,
              href: claudeUrl(
                t('pageActions.promptRead', { url: markdownUrl }),
              ),
              external: true,
            },
            {
              type: 'item',
              label: t('pageActions.openCursor'),
              icon: ExternalLink,
              href: cursorUrl(
                t('pageActions.promptContext', { url: markdownUrl }),
              ),
            },
          ],
        ]}
      />
    </div>
  );
}
