import { Filter } from 'lucide-react';
import { Loader2Icon } from 'lucide-react';
import { ComponentProps } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';

interface FilterButtonProps extends ComponentProps<typeof Button> {
  hasActiveFilters: boolean;
  isLoading?: boolean;
}

export function FilterButton({
  hasActiveFilters,
  isLoading = false,
  className,
  ...restProps
}: FilterButtonProps) {
  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn(
        'hover:bg-muted relative p-2.5',
        hasActiveFilters && 'border-primary',
        isLoading && 'opacity-75',
        className,
      )}
      {...restProps}
    >
      {isLoading ? (
        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
      ) : (
        <Filter className="text-muted-foreground size-4" />
      )}
      {hasActiveFilters && !isLoading && (
        <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-blue-500" />
      )}
    </Button>
  );
}
