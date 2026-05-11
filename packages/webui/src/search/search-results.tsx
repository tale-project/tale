import { cn } from '@tale/ui/cn';
import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  Hash,
  Type,
} from 'lucide-react';
import { type RefObject, useMemo } from 'react';

import { Highlight } from './highlight';
import { extractSnippet } from './snippet';
import type { SearchResult } from './types';

interface SearchResultsProps {
  results: SearchResult[];
  /** Fallback highlight terms used only when a result has no per-result
   *  `matchedTerms` — e.g. tests or callers that don't go through the
   *  rerank pipeline. */
  terms: readonly string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onSelect: (result: SearchResult) => void;
  /** Optional translator for section keys (e.g. "platform" → "Platform"). */
  sectionLabel?: (sectionKey: string) => string;
  /** For aria + keyboard nav glue. */
  optionIdPrefix: string;
  optionRefs: RefObject<Array<HTMLButtonElement | null>>;
}

interface ResultGroup {
  key: string;
  label: string;
  /** Original index in the flat results array — used for `optionIdPrefix-N`
   *  ids so keyboard navigation lines up with what the user sees. */
  items: { result: SearchResult; flatIndex: number }[];
}

const FALLBACK_SECTION = '__other';

export function groupBySection(
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

/** Resolve which fields a result matched in. Drives the leading icon: a
 *  page is "title hit", "heading hit", or "body hit" — meaningful labels,
 *  unlike the old "has section vs no section" distinction. */
function matchKind(result: SearchResult): 'title' | 'heading' | 'body' {
  const fields = new Set(Object.values(result.match ?? {}).flat());
  if (fields.has('title')) return 'title';
  if (fields.has('headings')) return 'heading';
  return 'body';
}

/** Build a breadcrumb from a URL path. Drops the last segment (it duplicates
 *  the page title) and the locale prefix (e.g. `/de`) so users see context
 *  like `Self-hosted › Configuration` instead of a raw URL. */
export function urlToBreadcrumb(
  url: string,
  sectionLabel?: (key: string) => string,
): string[] {
  if (!url || url === '/') return [];
  const segments = url
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return [];
  // Drop a leading 2-letter locale segment (`/de/...`, `/fr/...`).
  const head = segments[0] ?? '';
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(head)) segments.shift();
  // The last segment is usually the page slug — already shown as the title.
  // Keep it only when it's the *only* segment (we'd otherwise show nothing).
  const trail = segments.length > 1 ? segments.slice(0, -1) : segments;
  return trail.map((seg, i) =>
    i === 0 && sectionLabel ? sectionLabel(seg) : humanize(seg),
  );
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
                fallbackTerms={terms}
                isActive={flatIndex === activeIndex}
                onHover={() => setActiveIndex(flatIndex)}
                onSelect={() => onSelect(result)}
                optionId={`${optionIdPrefix}-${flatIndex}`}
                refCallback={(node) => {
                  optionRefs.current[flatIndex] = node;
                }}
                sectionLabel={sectionLabel}
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
  fallbackTerms: readonly string[];
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
  optionId: string;
  refCallback: (node: HTMLButtonElement | null) => void;
  sectionLabel?: (key: string) => string;
}

function SearchResultItem({
  result,
  fallbackTerms,
  isActive,
  onHover,
  onSelect,
  optionId,
  refCallback,
  sectionLabel,
}: ResultItemProps) {
  // Highlight the union of "what MiniSearch matched" + "what the user typed
  // that fired" — so a fuzzy/prefix match like config→configuration shows a
  // mark on configuration, while exact matches stay marked too. Defensive
  // against malformed results (tests, future callers) where these arrays
  // might be missing.
  const highlightTerms = useMemo(() => {
    const matched = Array.isArray(result.matchedTerms)
      ? result.matchedTerms
      : [];
    const queried = Array.isArray(result.queryTerms) ? result.queryTerms : [];
    const merged = [...matched, ...queried];
    if (merged.length === 0) return fallbackTerms;
    return Array.from(new Set(merged));
  }, [result.matchedTerms, result.queryTerms, fallbackTerms]);

  const snippet = useMemo(
    () => (result.body ? extractSnippet(result.body, highlightTerms, 150) : ''),
    [result.body, highlightTerms],
  );

  const kind = matchKind(result);
  const Icon = kind === 'heading' ? Hash : kind === 'title' ? Type : FileText;
  const breadcrumb = useMemo(
    () => urlToBreadcrumb(result.url, sectionLabel),
    [result.url, sectionLabel],
  );

  return (
    <li>
      <button
        type="button"
        role="option"
        id={optionId}
        aria-selected={isActive}
        ref={refCallback}
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={onSelect}
        data-match-kind={kind}
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
              <Highlight text={result.title} terms={highlightTerms} />
            </span>
          </span>
          {snippet ? (
            <span className="text-fg-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
              <Highlight text={snippet} terms={highlightTerms} />
            </span>
          ) : null}
          <span
            className="text-fg-subtle mt-1 flex min-w-0 items-center gap-1 truncate text-[10.5px]"
            aria-label={result.url}
          >
            {breadcrumb.length > 0 ? (
              breadcrumb.map((segment, i) => (
                <span
                  key={`${segment}-${i}`}
                  className="inline-flex shrink-0 items-center gap-1"
                >
                  {i > 0 ? (
                    <ChevronRight aria-hidden className="size-2.5 opacity-60" />
                  ) : null}
                  <span className="truncate">{segment}</span>
                </span>
              ))
            ) : (
              <span className="font-mono">{result.url}</span>
            )}
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
      </button>
    </li>
  );
}
