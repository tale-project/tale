import { cn } from '@tale/ui/cn';
import { motion } from 'framer-motion';
import { CornerDownLeft, FileText, Hash } from 'lucide-react';
import { type RefObject, useMemo } from 'react';

import { Highlight } from './highlight';
import { extractSnippet } from './snippet';
import type { SearchResult } from './types';

interface SearchResultsProps {
  results: SearchResult[];
  terms: readonly string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onSelect: (result: SearchResult) => void;
  /** Optional translator for section keys (e.g. "platform" → "Platform"). */
  sectionLabel?: (sectionKey: string) => string;
  /** For aria + keyboard nav glue. */
  optionIdPrefix: string;
  optionRefs: RefObject<Array<HTMLButtonElement | null>>;
  reduceMotion: boolean;
}

interface ResultGroup {
  key: string;
  label: string;
  /** Original index in the flat results array — used for `optionIdPrefix-N`
   *  ids so keyboard navigation lines up with what the user sees. */
  items: { result: SearchResult; flatIndex: number }[];
}

const FALLBACK_SECTION = '__other';

function groupBySection(
  results: SearchResult[],
  sectionLabel?: (key: string) => string,
): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  results.forEach((result, flatIndex) => {
    const key = result.section ?? FALLBACK_SECTION;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push({ result, flatIndex });
      return;
    }
    groups.set(key, {
      key,
      label: sectionLabel?.(key) ?? humanize(key),
      items: [{ result, flatIndex }],
    });
  });
  return Array.from(groups.values());
}

function humanize(key: string): string {
  if (key === FALLBACK_SECTION) return 'Docs';
  return key
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export function SearchResults({
  results,
  terms,
  activeIndex,
  setActiveIndex,
  onSelect,
  sectionLabel,
  optionIdPrefix,
  optionRefs,
  reduceMotion,
}: SearchResultsProps) {
  const groups = useMemo(
    () => groupBySection(results, sectionLabel),
    [results, sectionLabel],
  );

  return (
    <ol className="flex flex-col gap-4 px-2 py-3">
      {groups.map((group) => (
        <li key={group.key}>
          <div className="text-fg-subtle mb-1 px-3 text-[11px] font-semibold tracking-wider uppercase">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ result, flatIndex }) => (
              <SearchResultItem
                key={result.id}
                result={result}
                terms={terms}
                isActive={flatIndex === activeIndex}
                onHover={() => setActiveIndex(flatIndex)}
                onSelect={() => onSelect(result)}
                optionId={`${optionIdPrefix}-${flatIndex}`}
                refCallback={(node) => {
                  optionRefs.current[flatIndex] = node;
                }}
                reduceMotion={reduceMotion}
              />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

interface ResultItemProps {
  result: SearchResult;
  terms: readonly string[];
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
  optionId: string;
  refCallback: (node: HTMLButtonElement | null) => void;
  reduceMotion: boolean;
}

function SearchResultItem({
  result,
  terms,
  isActive,
  onHover,
  onSelect,
  optionId,
  refCallback,
  reduceMotion,
}: ResultItemProps) {
  const snippet = useMemo(
    () => (result.body ? extractSnippet(result.body, terms, 150) : ''),
    [result.body, terms],
  );

  const Icon = result.section ? Hash : FileText;

  return (
    <li>
      <motion.button
        layout={!reduceMotion ? 'position' : false}
        type="button"
        role="option"
        id={optionId}
        aria-selected={isActive}
        ref={refCallback}
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={onSelect}
        className={cn(
          'group relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
          'focus-visible:outline-none',
          isActive
            ? 'bg-bg-elevated text-fg-base'
            : 'text-fg-muted hover:bg-bg-elevated/60',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors',
            isActive
              ? 'border-border-strong bg-bg-base text-fg-base'
              : 'border-border-base/70 bg-bg-base/50 text-fg-muted',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-fg-base flex items-center gap-2 text-sm font-medium">
            <span className="truncate">
              <Highlight text={result.title} terms={terms} />
            </span>
          </span>
          {snippet ? (
            <span className="text-fg-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
              <Highlight text={snippet} terms={terms} />
            </span>
          ) : null}
          <span className="text-fg-subtle mt-1 block truncate font-mono text-[10.5px]">
            {result.url}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'mt-1 inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-opacity',
            isActive
              ? 'border-border-strong text-fg-base opacity-100'
              : 'border-border-base/50 text-fg-subtle opacity-0 group-hover:opacity-70',
          )}
        >
          <CornerDownLeft className="size-3" />
        </span>
      </motion.button>
    </li>
  );
}
