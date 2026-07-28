'use client';

import { Text } from '@tale/ui/text';

import { ConfigIcon } from '@/app/components/catalog/config-icon';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ComposerSkillOption } from '../types';

/**
 * The `/` command's listbox, floated above the composer textarea. Pure
 * presentation: the composer owns the trigger state, the highlight, and the
 * keyboard wiring (its textarea carries the combobox aria and forwards
 * ArrowUp/Down/Enter/Tab/Escape while this is open). Selection happens on
 * mousedown so the textarea never loses focus.
 */
export function SlashCommandPopover({
  listboxId,
  options,
  highlightedIndex,
  onHighlight,
  onSelect,
  onBrowseLibrary,
  optionId,
}: {
  listboxId: string;
  options: readonly ComposerSkillOption[];
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (slug: string) => void;
  /** Shown when no chat-usable skill exists at all. */
  onBrowseLibrary?: () => void;
  optionId: (index: number) => string;
}) {
  const { t } = useT('chat');

  return (
    <div className="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 z-50 mb-2 overflow-hidden rounded-md border shadow-md">
      {options.length === 0 ? (
        <div className="p-3">
          <Text as="p" variant="muted" className="text-sm">
            {t('slash.noMatches')}
          </Text>
          {onBrowseLibrary && (
            <button
              type="button"
              className="text-primary mt-1 text-sm underline-offset-2 hover:underline"
              onMouseDown={(e) => {
                e.preventDefault();
                onBrowseLibrary();
              }}
            >
              {t('slash.browseLibrary')}
            </button>
          )}
        </div>
      ) : (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('slash.listLabel')}
          className="max-h-64 overflow-y-auto py-1"
        >
          {options.map((option, index) => (
            <li
              key={option.slug}
              id={optionId(index)}
              role="option"
              aria-selected={index === highlightedIndex}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2',
                index === highlightedIndex &&
                  'bg-accent text-accent-foreground',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(option.slug);
              }}
              onMouseEnter={() => onHighlight(index)}
            >
              <ConfigIcon icon={option.icon} className="size-4 shrink-0" />
              <span className="min-w-0">
                <Text as="span" variant="code" className="block truncate">
                  /{option.slug}
                </Text>
                {option.description && (
                  <Text
                    as="span"
                    variant="caption"
                    className="text-muted-foreground block truncate"
                  >
                    {option.description}
                  </Text>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
