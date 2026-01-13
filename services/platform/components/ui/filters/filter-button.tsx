import { Button } from '@/components/ui/primitives/button';
import { Filter } from 'lucide-react';
import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ComponentProps } from 'react';

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
      variant="outline"
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
        <Loader2Icon className="size-4 text-muted-foreground animate-spin" />
      ) : (
        <Filter className="size-4 text-muted-foreground" />
      )}
      {hasActiveFilters && !isLoading && (
        <div className="absolute -top-1 -right-1 h-2 w-2 bg-blue-500 rounded-full" />
      )}
    </Button>
  );
}
