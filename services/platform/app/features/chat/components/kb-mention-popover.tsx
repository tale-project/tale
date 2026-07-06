'use client';

import { Row } from '@tale/ui/layout';
import {
  Highlight,
  type SearchResult,
  type SearchStatus,
} from '@tale/ui/search';
import { Text } from '@tale/ui/text';
import { Loader } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { KbMention } from '../hooks/use-kb-mentions';
import { AnchoredMentionPopoverShell } from './anchored-mention-popover-shell';

interface KbMentionPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  results: SearchResult<KbMention>[];
  status: SearchStatus;
  /** The query typed after `@` — drives highlighting + empty-state copy. */
  query: string;
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (mention: KbMention) => void;
  /** id of the listbox element (wired to the textarea's aria-controls). */
  listboxId: string;
  /** Option element id for `aria-activedescendant`. */
  optionId: (index: number) => string;
}

/**
 * Lightweight listbox anchored above the composer textarea for the `@`
 * knowledge-base mention picker. Purely presentational: the composer owns
 * the trigger state and keyboard navigation (Up/Down/Enter/Escape in
 * chat-input.tsx#handleKeyDown) and feeds `highlightedIndex` down — the
 * textarea keeps focus the whole time (combobox pattern).
 */
export function KbMentionPopover({
  anchorRef,
  open,
  results,
  status,
  query,
  highlightedIndex,
  onHighlight,
  onSelect,
  listboxId,
  optionId,
}: KbMentionPopoverProps) {
  const { t } = useT('composer');
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const terms = query.trim() ? [query.trim()] : [];

  return (
    <AnchoredMentionPopoverShell anchorRef={anchorRef} open={open}>
      <div className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs font-medium">
        {t('kbMention.title')}
      </div>
      {status === 'loading' ? (
        <Row
          role="status"
          aria-label={t('kbMention.loading')}
          gap={2}
          className="text-muted-foreground px-3 py-3"
        >
          <Loader className="size-3.5 animate-spin" />
          <Text as="span" variant="caption">
            {t('kbMention.loading')}
          </Text>
        </Row>
      ) : results.length === 0 ? (
        <Text
          as="div"
          variant="caption"
          className="text-muted-foreground px-3 py-3"
        >
          {query.trim() ? t('kbMention.empty') : t('kbMention.emptyNoQuery')}
        </Text>
      ) : (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('kbMention.title')}
          className="max-h-64 overflow-y-auto py-1"
        >
          {results.map((result, index) => {
            const mention = result.data;
            if (!mention) return null;
            const isActive = index === highlightedIndex;
            return (
              <li
                key={result.id}
                id={optionId(index)}
                role="option"
                aria-selected={isActive}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-2',
                  isActive && 'bg-accent text-accent-foreground',
                )}
                // Mouse selection must not steal focus from the textarea
                // (mousedown would blur it and close the picker before the
                // click lands), so select on mousedown and prevent default.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(mention);
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                <DocumentIcon
                  fileName={
                    mention.extension
                      ? `${mention.title}.${mention.extension}`
                      : mention.title
                  }
                  mimeType={mention.fileType}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <Text as="span" variant="label" className="block truncate">
                    <Highlight text={result.title} terms={terms} />
                  </Text>
                  {result.subtitle && (
                    <Text
                      as="span"
                      variant="caption"
                      className="text-muted-foreground block truncate"
                    >
                      {result.subtitle}
                    </Text>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AnchoredMentionPopoverShell>
  );
}
