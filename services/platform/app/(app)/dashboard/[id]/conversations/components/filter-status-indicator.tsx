'use client';

import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import {
  FilterState,
  TypeFilter,
  PriorityFilter,
} from '@/hooks/use-conversation-filters';

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

const typeLabels: Record<TypeFilter, string> = {
  product_recommendation: 'Product Recommendation',
  service_request: 'Service Request',
  churn_survey: 'Churn Survey',
  general: 'General',
  spam: 'Spam',
};

const priorityLabels = {
  low: 'Low Priority',
  medium: 'Medium Priority',
  high: 'High Priority',
};

export default function FilterStatusIndicator({
  searchQuery,
  filters,
  isLoading,
  onClearSearch,
  onClearFilter,
}: FilterStatusIndicatorProps) {
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
            Search: &quot;{searchQuery}&quot;
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
            Applying filters...
          </div>
        )}
      </div>
    </div>
  );
}
