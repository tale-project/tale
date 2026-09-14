import { Skeletonize } from '../feedback/skeleton-context';
import { SearchResultRow } from './search-result-row';

const noop = () => {};
const placeholderBreadcrumb = () => ['\u00a0'];

/** Pulsing placeholder rows shown while the first search of a query is in
 *  flight (and there are no stale results to keep visible). Shaped like the
 *  real result rows so the swap-in doesn't shift layout. */
export function SearchSkeleton({
  reduceMotion = false,
  rows = 4,
  showBreadcrumb = false,
}: {
  reduceMotion?: boolean;
  rows?: number;
  showBreadcrumb?: boolean;
}) {
  const id = useId();
  return (
    <Skeletonize
      loading
      className={reduceMotion ? '[&_*]:animate-none!' : undefined}
    >
      <ol className="flex flex-col gap-0.5 px-2 py-3" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <SearchResultRow
            key={i}
            result={{ id: `loading-${i}`, title: '\u00a0', subtitle: '\u00a0' }}
            fallbackTerms={[]}
            isActive={false}
            onHover={noop}
            onSelect={noop}
            optionId={`${id}-loading-result-${i}`}
            refCallback={noop}
            getBreadcrumb={showBreadcrumb ? placeholderBreadcrumb : undefined}
          />
        ))}
      </ol>
    </Skeletonize>
  );
}
import { useId } from 'react';
