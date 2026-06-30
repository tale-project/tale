'use client';

import { type SearchResult } from '@tale/ui/search';
import { Text } from '@tale/ui/text';
import { Bot, User } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface ActorMentionData {
  type: 'user' | 'agent';
  id: string;
  name: string;
  /** Plain-text `@token` inserted on select — matches a handle the server
   *  directory resolves (`convex/tasks/directory.ts`). */
  handle: string;
}

interface ActorMentionPopoverProps {
  results: SearchResult<ActorMentionData>[];
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (actor: ActorMentionData) => void;
  /** id of the listbox element (wired to the textarea's aria-controls). */
  listboxId: string;
  /** Option element id for `aria-activedescendant`. */
  optionId: (index: number) => string;
}

/**
 * Listbox anchored above the composer for the `@`-mention picker over a
 * project's actors (teammates + agents). Presentational — the composer owns the
 * trigger state and keyboard navigation (chat-input.tsx#handleKeyDown), the
 * textarea keeps focus (combobox pattern). The sibling of {@link KbMentionPopover}
 * for multi-party surfaces; selecting inserts a plain-text `@handle` (no chip).
 * Reuses the Tasks actor avatar + mention-picker strings so it matches the Tasks
 * mention UX.
 */
export function ActorMentionPopover({
  results,
  highlightedIndex,
  onHighlight,
  onSelect,
  listboxId,
  optionId,
}: ActorMentionPopoverProps) {
  const { t } = useT('tasks');
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  return (
    <div className="border-border bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-max max-w-sm min-w-56 overflow-hidden rounded-xl border shadow-lg">
      <div className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs font-medium">
        {t('mentionPicker.title')}
      </div>
      {results.length === 0 ? (
        <Text
          as="div"
          variant="caption"
          className="text-muted-foreground px-3 py-3"
        >
          {t('mentionPicker.empty')}
        </Text>
      ) : (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('mentionPicker.title')}
          className="max-h-64 overflow-y-auto py-1"
        >
          {results.map((result, index) => {
            const actor = result.data;
            if (!actor) return null;
            const isActive = index === highlightedIndex;
            return (
              <li
                key={result.id}
                id={optionId(index)}
                role="option"
                aria-selected={isActive}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-1.5',
                  isActive && 'bg-accent text-accent-foreground',
                )}
                // Select on mousedown (and prevent default) so the click
                // doesn't blur the textarea and close the picker first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(actor);
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                {actor.type === 'agent' ? (
                  <Bot
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                ) : (
                  <User
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                )}
                <Text as="span" variant="label" className="shrink-0 truncate">
                  {actor.name}
                </Text>
                <Text
                  as="span"
                  variant="caption"
                  className="text-muted-foreground min-w-0 flex-1 truncate"
                >
                  @{actor.handle}
                </Text>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
