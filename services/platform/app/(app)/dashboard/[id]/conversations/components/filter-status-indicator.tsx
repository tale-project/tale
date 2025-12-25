'use client';

import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import {
  FilterState,
  TypeFilter,
  PriorityFilter,
} from '@/hooks/use-conversation-filters';
import { useT } from '@/lib/i18n';

interface FilterStatusIndicatorProps {
  searchQuery: string;
  filters: FilterState;
  isLoading: boolean;
  onClearSearch: () => void;
  onClearFilter: (
    type: 'category' | 'priority',
    value?: TypeFilter | PriorityFilter,
  ) => void;
}

export default function FilterStatusIndicator({
  searchQuery,
  filters,
  isLoading,
  onClearSearch,
  onClearFilter,
}: FilterStatusIndicatorProps) {
  const { t } = useT('conversations');

  const typeLabels: Record<TypeFilter, string> = {
    product_recommendation: t('filters.typeOptions.productRecommendation'),
    service_request: t('filters.typeOptions.serviceRequest'),
    churn_survey: t('filters.typeOptions.churnSurvey'),
    general: t('filters.typeOptions.general'),
    spam: t('filters.typeOptions.spam'),
  };

  const priorityLabels: Record<PriorityFilter, string> = {
    low: t('filters.badges.lowPriority'),
    medium: t('filters.badges.mediumPriority'),
    high: t('filters.badges.highPriority'),
  };
  const hasActiveFilters =
    searchQuery || filters.types.length > 0 || filters.priorities.length > 0;

  if (!hasActiveFilters && !isLoading) {
    return null;
  }

  return (
    <div className="px-2 py-3 border-b border-border bg-muted">
      <div className="flex items-center flex-wrap relative">
        {searchQuery && (
          <Badge>
            {t('filters.badges.search', { query: searchQuery })}
            <button
              onClick={onClearSearch}
              className="hover:bg-muted-foreground/20 rounded-full p-0.5 ml-1"
            >
              <X className="size-3" />
            </button>
          </Badge>
        )}

        {filters.types.map((type) => (
          <Badge key={type} className="[&>span]:flex">
            {typeLabels[type]}
            <button
              onClick={() => onClearFilter('category', type)}
              className="hover:bg-muted-foreground/20 rounded-full p-0.5 ml-1"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        {filters.priorities.map((priority) => (
          <Badge key={priority} className="[&>span]:flex">
            {priorityLabels[priority]}
            <button
              onClick={() => onClearFilter('priority', priority)}
              className="hover:bg-muted-foreground/20 rounded-full p-0.5 ml-1"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}

        {isLoading && (
          <div className="text-xs text-muted-foreground absolute inset-0 flex items-center justify-center bg-muted/90 z-20">
            {t('filters.badges.applyingFilters')}
          </div>
        )}
      </div>
    </div>
  );
}
