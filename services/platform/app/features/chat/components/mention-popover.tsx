'use client';

import { Row } from '@tale/ui/layout';
import { Highlight } from '@tale/ui/search';
import { Text } from '@tale/ui/text';
import { ArrowUpRight, Bot, Loader, User } from 'lucide-react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { MentionActorOption } from '../../tasks/lib/mention-actor-options';
import type { KbMention } from '../hooks/use-kb-mentions';
import { AnchoredMentionPopoverShell } from './anchored-mention-popover-shell';

export type MentionSectionId = 'agents' | 'teammates' | 'documents';

/**
 * One selectable row of the unified `@`-mention picker. `document` rows pin a
 * knowledge-base chip, `actor` rows insert a plain-text `@handle`, and
 * `action` rows are a section's actionable empty state ("Upload documents",
 * "Invite teammates") — real options so they stay keyboard-reachable through
 * the same combobox navigation as entity rows.
 */
export type MentionRow =
  | {
      kind: 'document';
      id: string;
      data: KbMention;
      /** Folder path shown under the title (mirrors the search result). */
      subtitle?: string;
    }
  | { kind: 'actor'; id: string; data: MentionActorOption }
  | { kind: 'action'; id: string; label: string; run: () => void };

/**
 * A typed section of the picker (Agents / Teammates / Documents). Sections
 * with an `emptyMessage` and an action row form the actionable empty state;
 * sections whose query matched nothing are simply omitted by the composer.
 */
export interface MentionSection {
  id: MentionSectionId;
  label: string;
  rows: MentionRow[];
  /** Shown above the rows (i.e. above the action row) when the section has
   *  no entity matches — the "why is this empty" line. */
  emptyMessage?: string;
  /** True while the section's backing search is still resolving. */
  loading?: boolean;
}

interface MentionPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  sections: MentionSection[];
  /** The query typed after `@` — drives match highlighting. */
  query: string;
  /** Flat index over every option row across all sections, in order. */
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (row: MentionRow) => void;
  /** id of the listbox element (wired to the textarea's aria-controls). */
  listboxId: string;
  /** Option element id for `aria-activedescendant`, by flat index. */
  optionId: (index: number) => string;
}

/** Flattened option rows across sections — the keyboard-navigation order the
 *  composer's highlight index runs over. */
export function flattenMentionSections(
  sections: MentionSection[],
): MentionRow[] {
  return sections.flatMap((section) => section.rows);
}

function ActorIcon({ type }: { type: MentionActorOption['type'] }) {
  const Icon = type === 'agent' ? Bot : User;
  return <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />;
}

/**
 * The single `@`-mention picker for every chat composer surface: one listbox
 * with typed sections (Agents, Teammates, Documents), navigated as one flat
 * list. Purely presentational — the composer owns the trigger state and
 * keyboard navigation (chat-input.tsx#handleKeyDown) and feeds
 * `highlightedIndex` down; the textarea keeps focus the whole time (combobox
 * pattern), so rows select on mousedown (preventDefault keeps focus).
 */
export function MentionPopover({
  anchorRef,
  open,
  sections,
  query,
  highlightedIndex,
  onHighlight,
  onSelect,
  listboxId,
  optionId,
}: MentionPopoverProps) {
  const { t } = useT('composer');
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const terms = query.trim() ? [query.trim()] : [];
  const anyLoading = sections.some((s) => s.loading);
  const totalRows = flattenMentionSections(sections).length;

  const renderOption = (
    row: MentionRow,
    flatIndex: number,
    children: ReactNode,
  ) => (
    <li
      key={row.id}
      id={optionId(flatIndex)}
      role="option"
      aria-selected={flatIndex === highlightedIndex}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
        flatIndex === highlightedIndex && 'bg-accent text-accent-foreground',
      )}
      // Mouse selection must not steal focus from the textarea (mousedown
      // would blur it and close the picker before the click lands), so
      // select on mousedown and prevent default.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(row);
      }}
      onMouseEnter={() => onHighlight(flatIndex)}
    >
      {children}
    </li>
  );

  // Flat index of each section's first row (options are numbered across
  // sections so aria-activedescendant maps 1:1 to the composer's highlight).
  let nextFlatIndex = 0;

  return (
    <AnchoredMentionPopoverShell anchorRef={anchorRef} open={open}>
      {totalRows === 0 && anyLoading ? (
        <Row
          role="status"
          aria-label={t('mention.loading')}
          gap={2}
          className="text-muted-foreground px-3 py-3"
        >
          <Loader className="size-3.5 animate-spin" />
          <Text as="span" variant="caption">
            {t('mention.loading')}
          </Text>
        </Row>
      ) : totalRows === 0 ? (
        <Text
          as="div"
          variant="caption"
          className="text-muted-foreground px-3 py-3"
        >
          {t('mention.noMatches')}
        </Text>
      ) : (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('mention.title')}
          className="max-h-64 overflow-y-auto pb-1"
        >
          {/* One flat listbox: section headers and empty-state lines are
              presentation rows (aria-required-children allows only
              option/group/presentation inside a listbox), option rows are
              numbered ACROSS sections so aria-activedescendant maps 1:1 to
              the composer's flat highlight index. */}
          {sections.map((section) => {
            const startIndex = nextFlatIndex;
            nextFlatIndex += section.rows.length;
            if (section.rows.length === 0 && !section.loading) return null;
            return [
              <li
                key={`${section.id}-header`}
                role="presentation"
                className="text-muted-foreground border-border border-b px-3 py-1.5 text-xs font-medium"
              >
                {section.label}
              </li>,
              section.loading ? (
                <li key={`${section.id}-loading`} role="presentation">
                  <Row gap={2} className="text-muted-foreground px-3 py-2">
                    <Loader className="size-3.5 animate-spin" aria-hidden />
                    <Text as="span" variant="caption">
                      {t('mention.loading')}
                    </Text>
                  </Row>
                </li>
              ) : null,
              section.emptyMessage && !section.loading ? (
                <li
                  key={`${section.id}-empty`}
                  role="presentation"
                  className="text-muted-foreground px-3 pt-2 pb-1"
                >
                  <Text as="span" variant="caption">
                    {section.emptyMessage}
                  </Text>
                </li>
              ) : null,
              ...section.rows.map((row, indexInSection) => {
                const flatIndex = startIndex + indexInSection;
                if (row.kind === 'action') {
                  return renderOption(
                    row,
                    flatIndex,
                    <>
                      <ArrowUpRight
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <Text
                        as="span"
                        variant="label"
                        className="min-w-0 flex-1 truncate"
                      >
                        {row.label}
                      </Text>
                    </>,
                  );
                }
                if (row.kind === 'actor') {
                  const actor = row.data;
                  return renderOption(
                    row,
                    flatIndex,
                    <>
                      <ActorIcon type={actor.type} />
                      <Text
                        as="span"
                        variant="label"
                        className="min-w-0 flex-1 truncate"
                      >
                        <Highlight text={actor.name} terms={terms} />
                      </Text>
                      <Text
                        as="span"
                        variant="caption"
                        className="text-muted-foreground max-w-[9rem] shrink-0 truncate"
                      >
                        @{actor.handle}
                      </Text>
                    </>,
                  );
                }
                const mention = row.data;
                return renderOption(
                  row,
                  flatIndex,
                  <>
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
                      <Text
                        as="span"
                        variant="label"
                        className="block truncate"
                      >
                        <Highlight text={mention.title} terms={terms} />
                      </Text>
                      {row.subtitle && (
                        <Text
                          as="span"
                          variant="caption"
                          className="text-muted-foreground block truncate"
                        >
                          {row.subtitle}
                        </Text>
                      )}
                    </span>
                  </>,
                );
              }),
            ];
          })}
        </ul>
      )}
    </AnchoredMentionPopoverShell>
  );
}
