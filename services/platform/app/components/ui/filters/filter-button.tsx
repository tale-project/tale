import { ListFilter } from 'lucide-react';
import { Loader2Icon } from 'lucide-react';
import { ComponentProps } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
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
  const { t } = useT('common');

  return (
    <Button
      variant="secondary"
      aria-label={t('labels.filter')}
      className={cn(
        'hover:bg-muted relative gap-2',
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
}
