import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { ListFilter } from 'lucide-react';
import { Loader2Icon } from 'lucide-react';
import { forwardRef, type ComponentProps } from 'react';

// Intersection (not `interface extends`) because Button's props are a
// discriminated union (icon size requires aria-label) — an interface can't
// extend a union, but an intersection distributes over it cleanly.
type FilterButtonProps = ComponentProps<typeof Button> & {
  hasActiveFilters: boolean;
  isLoading?: boolean;
  /**
   * Drop the visible "Filter" word and keep the icon alone, for a toolbar with
   * no width to spend on it — the inbox list pane is a fixed 24.75rem column
   * shared with a search box. The accessible name does not change: it comes
   * from `aria-label`, which this button always sets.
   */
  iconOnly?: boolean;
};

export const FilterButton = forwardRef<HTMLButtonElement, FilterButtonProps>(
  function FilterButton(
    {
      hasActiveFilters,
      isLoading = false,
      iconOnly = false,
      className,
      ...restProps
    },
    ref,
  ) {
    const { t } = useT('common');

    return (
      <Button
        ref={ref}
        variant="secondary"
        aria-label={t('labels.filter')}
        className={cn(
          'hover:bg-muted relative h-9 gap-2',
          iconOnly && 'w-9 shrink-0 justify-center gap-0 px-0',
          hasActiveFilters && 'border-primary',
          isLoading && 'opacity-75',
          className,
        )}
        {...restProps}
      >
        {isLoading ? (
          <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
        ) : (
          <ListFilter className="text-muted-foreground size-4" />
        )}
        {!iconOnly && t('labels.filter')}
        {hasActiveFilters && !isLoading && (
          <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-blue-500" />
        )}
      </Button>
    );
  },
);
