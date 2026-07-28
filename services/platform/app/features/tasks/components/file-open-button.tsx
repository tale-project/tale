'use client';

import { cn } from '@/lib/utils/cn';

/**
 * A file in a task's zones, as a clickable NAME.
 *
 * The click target is the text and nothing more: a file name stretched into a
 * full-width row paints a hover band across the whole column for a target three
 * words wide, and it forces one file per line even where a dozen short names
 * would sit comfortably on two. Both zones (Files, Outcome) render their names
 * through this, so the affordance for "open this file" is defined once.
 *
 * `emphasis` is for a declared deliverable — the file a reviewer opened the task
 * for — against the working material around it.
 */
export function FileOpenButton({
  name,
  label,
  emphasis = false,
  onOpen,
}: {
  /** The visible file name. */
  name: string;
  /** Accessible name ("Open <file>") — the visible text alone reads as a noun. */
  label: string;
  /** Render as a deliverable rather than ordinary material. */
  emphasis?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={cn(
        'hover:bg-muted/50 focus-visible:ring-ring max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none',
        emphasis && 'font-medium',
      )}
    >
      {name}
    </button>
  );
}
