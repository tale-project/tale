import { cn } from '@tale/ui/cn';
import { Fragment } from 'react';

interface HighlightProps {
  text: string;
  terms: readonly string[];
  className?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render `text` with case-insensitive runs of any `terms` wrapped in a
 *  `<mark>`. Empty/whitespace-only terms are ignored. */
export function Highlight({ text, terms, className }: HighlightProps) {
  if (!text) return null;
  const filtered = terms.filter((t) => t.length > 0).map(escapeRegex);
  if (filtered.length === 0) return <>{text}</>;

  const regex = new RegExp(`(${filtered.join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            // The split alternates [text, match, text, match, …] so odd
            // indices are always matches. Index is stable per render.
            // oxlint-disable-next-line react/no-array-index-key
            key={i}
            className={cn(
              'rounded-[3px] bg-amber-400/25 px-0.5 text-fg-base dark:bg-amber-300/20',
              className,
            )}
          >
            {part}
          </mark>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
