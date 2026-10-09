import { cn } from '@tale/ui/cn';
import type { ComponentPropsWithoutRef } from 'react';

export interface MentionChipProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  /** Who is mentioned, shown after `@`: their current name. */
  name: string;
  /** What kind of actor this is ("Agent"), read after the name by screen
   * readers, which do not see a tint or a title. */
  kindLabel?: string;
  /** Whoever was mentioned cannot be found any more: the chip turns muted
   * and `missingLabel` says why, in place of the kind. */
  missing?: boolean;
  /** Why a missing mention is muted ("Deleted agent"), read after the name
   * and shown on hover. */
  missingLabel?: string;
}

/**
 * A mention inside text: `@` and a name on a tinted ground, inline with the
 * words around it. A mention of someone who is gone reads muted, with its
 * reason for screen readers and on hover; never an id.
 *
 * The name sits in `<bdi>`, so a name in another script direction cannot
 * reorder the sentence around it. The chip is not interactive.
 */
export function MentionChip({
  name,
  kindLabel,
  missing = false,
  missingLabel,
  title,
  className,
  ...props
}: MentionChipProps) {
  const spoken = missing ? missingLabel : kindLabel;
  return (
    <span
      data-slot="mention-chip"
      data-missing={missing || undefined}
      title={title ?? (missing ? missingLabel : undefined)}
      className={cn(
        'rounded-md box-decoration-clone px-1 py-0.5 text-[0.9em] leading-none font-medium',
        missing
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary/10 text-primary',
        className,
      )}
      {...props}
    >
      <bdi>@{name}</bdi>
      {spoken !== undefined &&
        spoken !== '' && (
          // Selecting text around the chip copies its name, not this.
          <span className="sr-only select-none">{` (${spoken})`}</span>
        )}
    </span>
  );
}
