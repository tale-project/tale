import { Button } from '@tale/ui/button';
import { ListFilter } from 'lucide-react';
import { Loader2Icon } from 'lucide-react';
import { forwardRef, type ComponentProps } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// Intersection (not `interface extends`) because Button's props are a
// discriminated union (icon size requires aria-label) — an interface can't
// extend a union, but an intersection distributes over it cleanly.
type FilterButtonProps = ComponentProps<typeof Button> & {
  hasActiveFilters: boolean;
  isLoading?: boolean;
};

export const FilterButton = forwardRef<HTMLButtonElement, FilterButtonProps>(
  function FilterButton(
    { hasActiveFilters, isLoading = false, className, ...restProps },
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
        {t('labels.filter')}
        {hasActiveFilters && !isLoading && (
          <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-blue-500" />
        )}
      </Button>
    );
  },
);
