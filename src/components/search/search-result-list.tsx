import type { ReactNode, RefObject } from 'react';

import type { ResultGroup } from './group-by';
import {
  type BreadcrumbResolver,
  type ResultIconResolver,
  SearchResultRow,
} from './search-result-row';
import type { SearchResult } from './types';

export interface RenderResultArgs {
  result: SearchResult;
  isActive: boolean;
  fallbackTerms: readonly string[];
  onHover: () => void;
  onSelect: () => void;
  optionId: string;
  refCallback: (node: HTMLButtonElement | null) => void;
}

interface SearchResultListProps {
  groups: ResultGroup[];
  /** Fallback highlight terms when a result lacks per-result matched terms. */
  terms: readonly string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onSelect: (result: SearchResult) => void;
  optionIdPrefix: string;
  optionRefs: RefObject<Array<HTMLButtonElement | null>>;
  resultIcon?: ResultIconResolver;
  getBreadcrumb?: BreadcrumbResolver;
  /** Full row-render override — lets a surface own a row's markup while still
   *  getting grouping, keyboard nav, a11y wiring and the dialog chrome. */
  renderResult?: (args: RenderResultArgs) => ReactNode;
}

/** Renders the grouped result list. Groups (and the `visualIndex` on each
 *  item) are computed upstream by the controller so this stays a pure render. */
export function SearchResultList({
  groups,
  terms,
  activeIndex,
  setActiveIndex,
  onSelect,
  optionIdPrefix,
  optionRefs,
  resultIcon,
  getBreadcrumb,
  renderResult,
}: SearchResultListProps) {
  return (
    <ol role="list" className="flex flex-col gap-4 px-2 py-3">
      {groups.map((group) => (
        <li key={group.key}>
          {group.label ? (
            <div className="text-fg-subtle mb-1 px-3 text-[11px] font-semibold tracking-wider uppercase">
              {group.label}
            </div>
          ) : null}
          <ul role="list" className="flex flex-col gap-0.5">
            {group.items.map(({ result, visualIndex }) => {
              const isActive = visualIndex === activeIndex;
              const optionId = `${optionIdPrefix}-${visualIndex}`;
              const onHover = () => setActiveIndex(visualIndex);
              const handleSelect = () => onSelect(result);
              const refCallback = (node: HTMLButtonElement | null) => {
                optionRefs.current[visualIndex] = node;
              };
              if (renderResult) {
                return (
                  <li key={result.id}>
                    {renderResult({
                      result,
                      isActive,
                      fallbackTerms: terms,
                      onHover,
                      onSelect: handleSelect,
                      optionId,
                      refCallback,
                    })}
                  </li>
                );
              }
              return (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  fallbackTerms={terms}
                  isActive={isActive}
                  onHover={onHover}
                  onSelect={handleSelect}
                  optionId={optionId}
                  refCallback={refCallback}
                  resultIcon={resultIcon}
                  getBreadcrumb={getBreadcrumb}
                />
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
