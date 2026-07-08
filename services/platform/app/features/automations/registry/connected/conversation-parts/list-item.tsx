'use client';

/**
 * One conversation row — the list-item anatomy promoted from the retired inbox
 * (`conversations-list.tsx`): sender heading + unread dot + timestamp on the
 * first line, title below, a one-line preview snippet, then a badge row. The
 * whole row is a real full-width `<button>` (no interactive descendants — the
 * content layer is pointer-events-none, so a click anywhere opens the row)
 * with the optional multi-select checkbox re-enabling pointer events for
 * itself; the selected row is marked with `aria-current` (a master list of
 * buttons, not a listbox — rows contain a second control).
 */
import { Checkbox } from '@tale/ui/checkbox';
import { Heading } from '@tale/ui/heading';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export interface ConversationListItemProps {
  /** Title line (also the accessible name fallback). */
  title?: string;
  sender?: string;
  /** Single-line preview snippet (already cleaned to plain text). */
  preview?: string;
  /** Pre-formatted timestamp label (e.g. `formatDateSmart` output). */
  timestampLabel?: string;
  unread?: boolean;
  /** Badge row content (e.g. the status badge). */
  badge?: ReactNode;
  selected?: boolean;
  showCheckbox?: boolean;
  checked?: boolean;
  onOpen?: () => void;
  onCheckedChange?: (checked: boolean) => void;
  /** Accessible label for the multi-select checkbox. */
  checkboxLabel?: string;
  /** Accessible label for the unread indicator dot. */
  unreadLabel?: string;
}

export function ConversationListItem({
  title,
  sender,
  preview,
  timestampLabel,
  unread = false,
  badge,
  selected = false,
  showCheckbox = false,
  checked = false,
  onOpen,
  onCheckedChange,
  checkboxLabel,
  unreadLabel,
}: ConversationListItemProps) {
  return (
    <div
      className={cn(
        'hover:bg-muted relative cursor-pointer px-4 py-2.5 transition-colors',
        selected && 'bg-muted',
      )}
    >
      {selected && (
        <div className="bg-primary absolute top-0 bottom-0 left-0 z-10 w-1" />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
        aria-label={title || sender}
        className="absolute inset-0 z-0"
      />
      <div className="pointer-events-none relative z-10 flex items-start gap-2.5">
        {showCheckbox && (
          <Row gap={0} className="pointer-events-auto mt-0.5">
            <Checkbox
              checked={checked}
              onCheckedChange={(value) => {
                if (typeof value === 'boolean') onCheckedChange?.(value);
              }}
              aria-label={checkboxLabel}
            />
          </Row>
        )}

        <div className="min-w-0 flex-1">
          <Row gap={2} justify="between" className="mb-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Heading
                level={3}
                size="sm"
                weight="semibold"
                tracking="tight"
                truncate
                className="flex-1"
              >
                {sender || title}
              </Heading>
              {unread && (
                <>
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400"
                    aria-hidden
                  />
                  <span className="sr-only">{unreadLabel}</span>
                </>
              )}
            </div>
            {timestampLabel && (
              <Text
                as="span"
                variant="label-sm"
                className="text-muted-foreground shrink-0 tracking-tight"
              >
                {timestampLabel}
              </Text>
            )}
          </Row>

          {sender && title && (
            <Text variant="muted" truncate className="mb-1.5 tracking-tight">
              {title}
            </Text>
          )}

          {preview && (
            <Text variant="caption" truncate className="mb-2 tracking-tight">
              {preview}
            </Text>
          )}

          {badge && <HStack gap={2}>{badge}</HStack>}
        </div>
      </div>
    </div>
  );
}
