import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  Hash,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../../lib/cn';
import { Highlight } from './highlight';
import { extractSnippet } from './snippet';
import type { SearchResult } from './types';

export type ResultIconResolver = (
  result: SearchResult,
) => ComponentType<{ className?: string }> | undefined;

export type BreadcrumbResolver = (result: SearchResult) => string[];

interface SearchResultRowProps {
  result: SearchResult;
  /** Fallback highlight terms when a result carries no `matchedTerms`/`queryTerms`. */
  fallbackTerms: readonly string[];
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
  optionId: string;
  refCallback: (node: HTMLButtonElement | null) => void;
  /** Per-surface icon default when `result.icon` is unset. */
  resultIcon?: ResultIconResolver;
  /** Render a breadcrumb trail (docs). Omitted ⇒ no breadcrumb line. */
  getBreadcrumb?: BreadcrumbResolver;
}

/** Resolve which fields a docs result matched — drives the leading icon when
 *  no explicit icon is supplied. */
function matchKindIcon(
  result: SearchResult,
): ComponentType<{ className?: string }> | undefined {
  if (!result.match) return undefined;
  const fields = new Set(Object.values(result.match).flat());
  if (fields.has('title')) return Type;
  if (fields.has('headings')) return Hash;
  if (fields.has('body')) return FileText;
  return undefined;
}

export function SearchResultRow({
  result,
  fallbackTerms,
  isActive,
  onHover,
  onSelect,
  optionId,
  refCallback,
  resultIcon,
  getBreadcrumb,
}: SearchResultRowProps) {
  // Cheap per-render derivations — a row only renders for the handful of
  // results on screen, so these stay inline (no memo overhead per the project's
  // "profile-justified hooks only" rule).

  // Highlight the union of "what the index matched" + "what the user typed
  // that fired". Defensive against malformed results where these are missing.
  const matched = Array.isArray(result.matchedTerms) ? result.matchedTerms : [];
  const queried = Array.isArray(result.queryTerms) ? result.queryTerms : [];
  const merged = [...matched, ...queried];
  const highlightTerms =
    merged.length === 0 ? fallbackTerms : Array.from(new Set(merged));

  // Secondary line: a highlighted snippet extracted from `body` (docs), else
  // the explicit `subtitle` (platform entities).
  const secondary = result.body
    ? extractSnippet(result.body, highlightTerms, 150)
    : (result.subtitle ?? '');

  const Icon =
    result.icon ?? resultIcon?.(result) ?? matchKindIcon(result) ?? FileText;

  const breadcrumb = getBreadcrumb?.(result) ?? [];

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
          {secondary ? (
            <span className="text-fg-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
              <Highlight text={secondary} terms={highlightTerms} />
            </span>
          ) : null}
          {breadcrumb.length > 0 ? (
            <span
              className="text-fg-subtle mt-1 flex min-w-0 items-center gap-1 truncate text-[10.5px]"
              aria-label={breadcrumb.join(' › ')}
            >
              {breadcrumb.map((segment, i) => (
                <span
                  key={`${segment}-${i}`}
                  className="inline-flex shrink-0 items-center gap-1"
                >
                  {i > 0 ? (
                    <ChevronRight aria-hidden className="size-2.5 opacity-60" />
                  ) : null}
                  <span className="truncate">{segment}</span>
                </span>
              ))}
            </span>
          ) : null}
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
