import { cn } from '../../lib/cn';

/** Pulsing placeholder rows shown while the first search of a query is in
 *  flight (and there are no stale results to keep visible). Shaped like the
 *  real result rows so the swap-in doesn't shift layout. */
export function SearchSkeleton({
  reduceMotion = false,
  rows = 4,
}: {
  reduceMotion?: boolean;
  rows?: number;
}) {
  return (
    <ol className="flex flex-col gap-0.5 px-2 py-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <div
            className={cn(
              'flex w-full items-start gap-3 rounded-lg px-3 py-2.5',
              reduceMotion ? '' : 'animate-pulse motion-reduce:animate-none',
            )}
          >
            <span className="bg-bg-elevated mt-0.5 size-7 shrink-0 rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="bg-bg-elevated h-3 w-1/3 rounded" />
              <span className="bg-bg-elevated h-2.5 w-3/4 rounded" />
              <span className="bg-bg-elevated h-2 w-1/4 rounded" />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
