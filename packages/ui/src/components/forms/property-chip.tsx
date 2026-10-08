'use client';

import { cn } from '@tale/ui/cn';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Plus } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface PropertyChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /**
   * The glyph before a set value: a Lucide icon (sized for the chip) or a
   * composed mark such as a status glyph or an avatar, which keeps its own
   * size. Replaced by a plus while the chip is `empty`.
   */
  icon?: ReactNode;
  /** The value — or, while `empty`, the property's name ("Due date"). */
  children: ReactNode;
  /** No value yet: the chip reads muted, with a plus in place of `icon`. */
  empty?: boolean;
}

/**
 * A property as a pill: the glyph and value of one field (Status, Priority,
 * Assignee, Due date …) in a row of chips under a form, each the trigger of
 * the picker that changes it. An unset property shows its name, muted, after
 * a plus.
 *
 * The chip is a plain `button` that forwards its ref and every prop, so a
 * picker can use it as its trigger (`<PopoverTrigger asChild>`); the picker
 * supplies `aria-expanded` and `aria-haspopup`, and `data-state="open"` keeps
 * the chip filled while its popover is open. When the visible value alone
 * does not say which property it is ("Medium"), give it an `aria-label` that
 * starts with that value and names the property ("Medium priority").
 */
export const PropertyChip = forwardRef<HTMLButtonElement, PropertyChipProps>(
  ({ icon, children, empty = false, className, type, ...props }, ref) => (
    <SkeletonBox asChild>
      <button
        ref={ref}
        type={type ?? 'button'}
        data-empty={empty ? '' : undefined}
        className={cn(
          'border-border bg-background text-foreground inline-flex h-8 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap',
          'hover:bg-accent data-[state=open]:bg-accent transition-colors duration-[var(--duration-short)] motion-reduce:transition-none',
          'focus-visible:ring-ring ring-offset-background focus-visible:ring-1 focus-visible:outline-none',
          'disabled:hover:bg-background disabled:cursor-not-allowed disabled:opacity-50',
          empty && 'text-muted-foreground',
          className,
        )}
        {...props}
      >
        {empty ? (
          <Plus className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          icon !== undefined &&
          icon !== null && (
            <span
              aria-hidden="true"
              className="text-muted-foreground flex shrink-0 items-center [&>svg]:size-3.5"
            >
              {icon}
            </span>
          )
        )}
        <span className="min-w-0 truncate">{children}</span>
      </button>
    </SkeletonBox>
  ),
);
PropertyChip.displayName = 'PropertyChip';
