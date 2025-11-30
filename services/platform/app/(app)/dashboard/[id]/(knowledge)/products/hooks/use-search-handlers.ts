import {
  Dispatch,
  SetStateAction,
  KeyboardEvent,
  ChangeEvent,
  FocusEvent,
} from 'react';
import { ReadonlyURLSearchParams } from 'next/navigation';

interface UseSearchHandlersProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  searchParams: ReadonlyURLSearchParams;
  router: {
    push: (url: string) => void;
  };
  businessId: string;
  startTransition: (callback: () => void) => void;
}

export function useSearchHandlers({
  query,
  setQuery,
  searchParams,
  router,
  businessId,
  startTransition,
}: UseSearchHandlersProps) {
  const handleSearch = () => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmedQuery = query.trim();
      if (trimmedQuery) {
        params.set('query', trimmedQuery);
      } else {
        params.delete('query');
      }
      // Reset to first page when searching
      params.delete('page');
      router.push(`/dashboard/${businessId}/products?${params.toString()}`);
    });
  };

  const handleQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Only trigger search on blur if the query has been cleared
    if (newValue === '' && searchParams.get('query')) {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('query');
        params.delete('page');
        router.push(`/dashboard/${businessId}/products?${params.toString()}`);
      });
    }
  };

  return {
    handleSearch,
    handleQueryKeyDown,
    handleQueryChange,
    handleBlur,
  };
}
