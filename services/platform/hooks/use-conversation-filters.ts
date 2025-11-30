import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';

export type TypeFilter =
  | 'product-recommendation'
  | 'service-request'
  | 'churn-survey';
export type PriorityFilter = 'low' | 'medium' | 'high';

export interface FilterState {
  types: TypeFilter[];
  priorities: PriorityFilter[];
}

export interface ConversationFilters {
  searchQuery: string;
  filters: FilterState;
  isLoading: boolean;
  isDirty: boolean;
  setSearchQuery: (query: string) => void;
  setFilters: (filters: FilterState) => void;
  applyFilters: () => void;
  clearAllFilters: () => void;
  clearSearch: () => void;
  clearFilter: (
    type: 'category' | 'priority',
    value?: TypeFilter | PriorityFilter,
  ) => void;
}

export function useConversationFilters(): ConversationFilters {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Parse URL parameters (server state)
  const urlSearchQuery = searchParams.get('search') || '';
  const categoryParam = searchParams.get('category');
  const priorityParam = searchParams.get('priority');

  // Handle multiple category filters (comma-separated)
  const types: TypeFilter[] = [];
  if (categoryParam) {
    const categoryValues = categoryParam.split(',');
    categoryValues.forEach((value) => {
      if (
        ['product-recommendation', 'service-request', 'churn-survey'].includes(
          value,
        )
      ) {
        types.push(value as TypeFilter);
      }
    });
  }

  // Handle multiple priority filters (comma-separated)
  const priorities: PriorityFilter[] = [];
  if (priorityParam) {
    const priorityValues = priorityParam.split(',');
    priorityValues.forEach((value) => {
      if (['low', 'medium', 'high'].includes(value)) {
        priorities.push(value as PriorityFilter);
      }
    });
  }

  const urlFilters: FilterState = { types, priorities };

  // Local state for immediate UI updates (before applying to URL)
  const [localSearchQuery, setLocalSearchQuery] = useState(urlSearchQuery);
  const [localFilters, setLocalFilters] = useState<FilterState>(urlFilters);

  // Return local state for immediate UI updates
  const searchQuery = localSearchQuery;
  const filters = localFilters;

  // Check if current local state differs from URL state (enables apply button)
  const searchChanged = localSearchQuery.trim() !== urlSearchQuery.trim();

  const typesChanged =
    localFilters.types.length !== urlFilters.types.length ||
    !localFilters.types.every((type) => urlFilters.types.includes(type));

  const prioritiesChanged =
    localFilters.priorities.length !== urlFilters.priorities.length ||
    !localFilters.priorities.every((priority) =>
      urlFilters.priorities.includes(priority),
    );

  const isDirty = searchChanged || typesChanged || prioritiesChanged;

  // Update URL parameters
  function updateParams(updates: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      ) {
        params.delete(key);
      } else if (Array.isArray(value)) {
        // Join array values with commas
        params.set(key, value.join(','));
      } else {
        params.set(key, value);
      }
    });

    const newUrl = `${pathname}?${params.toString()}`;
    router.replace(newUrl);
  }

  function setSearchQuery(query: string) {
    // Only update local state - no URL update until applyFilters is called
    setLocalSearchQuery(query);
  }

  function setFilters(newFilters: FilterState) {
    // Update local state and immediately update URL
    setLocalFilters(newFilters);
    startTransition(() => {
      updateParams({
        category: newFilters.types.length > 0 ? newFilters.types : null,
        priority:
          newFilters.priorities.length > 0 ? newFilters.priorities : null,
      });
    });
  }

  function applyFilters() {
    // Apply current local state to URL
    startTransition(() => {
      updateParams({
        search: localSearchQuery.trim() || null,
        category: localFilters.types.length > 0 ? localFilters.types : null,
        priority:
          localFilters.priorities.length > 0 ? localFilters.priorities : null,
      });
    });
  }

  function clearSearch() {
    setLocalSearchQuery('');
    startTransition(() => {
      updateParams({ search: null });
    });
  }

  function clearFilter(
    type: 'category' | 'priority',
    value?: TypeFilter | PriorityFilter,
  ) {
    if (value) {
      // Remove specific filter value
      const newFilters = {
        types:
          type === 'category'
            ? localFilters.types.filter((t) => t !== value)
            : localFilters.types,
        priorities:
          type === 'priority'
            ? localFilters.priorities.filter((p) => p !== value)
            : localFilters.priorities,
      };

      setLocalFilters(newFilters);
      startTransition(() => {
        const paramKey = type === 'category' ? 'category' : 'priority';
        const remainingValues =
          type === 'category' ? newFilters.types : newFilters.priorities;

        updateParams({
          [paramKey]: remainingValues.length > 0 ? remainingValues : null,
        });
      });
    } else {
      // Clear entire category (backward compatibility)
      const newFilters = {
        types: type === 'category' ? [] : localFilters.types,
        priorities: type === 'priority' ? [] : localFilters.priorities,
      };

      setLocalFilters(newFilters);
      startTransition(() => {
        updateParams({
          [type]: null,
        });
      });
    }
  }

  function clearAllFilters() {
    // Immediate UI update
    setLocalSearchQuery('');
    setLocalFilters({ types: [], priorities: [] });

    // Immediate URL update
    startTransition(() => {
      updateParams({
        search: null,
        category: null,
        priority: null,
      });
    });
  }

  return {
    searchQuery,
    filters,
    isLoading: isPending,
    isDirty,
    setSearchQuery,
    setFilters,
    applyFilters,
    clearAllFilters,
    clearSearch,
    clearFilter,
  };
}
