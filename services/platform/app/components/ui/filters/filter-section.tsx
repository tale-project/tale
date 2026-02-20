import { ChevronDown } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface FilterSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  selectedCount?: number;
  hasSelection?: boolean;
}

export function FilterSection({
  title,
  isExpanded,
  onToggle,
  children,
  selectedCount = 0,
  hasSelection = false,
}: FilterSectionProps) {
  const { t } = useT('common');

  return (
    <div className="border-border border-t p-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-2"
        aria-expanded={isExpanded}
      >
        <span className="text-muted-foreground/80 flex-1 text-left text-xs font-medium uppercase">
          {title}
        </span>
        {selectedCount > 0 && (
          <span className="rounded-xl bg-blue-100/20 px-1.5 py-0.5 text-[10px] leading-3 font-medium text-blue-600">
            {t('labels.nSelected', { count: selectedCount })}
          </span>
        )}
        {hasSelection && selectedCount === 0 && (
          <span
            className="size-2 rounded-full bg-blue-600"
            aria-hidden="true"
          />
        )}
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
            !isExpanded && '-rotate-90',
          )}
        />
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-1 px-1 pb-1">{children}</div>
      )}
    </div>
  );
}
