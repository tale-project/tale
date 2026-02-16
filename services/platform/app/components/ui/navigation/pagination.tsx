'use client';

import { useNavigate, useLocation, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useState, useEffect, useTransition } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { Button } from '@/app/components/ui/primitives/button';

interface PaginationProps {
  currentPage: number;
  total?: number;
  pageSize?: number; // Used for pagination calculations and dynamic size options
  totalPages?: number; // Optional, for compatibility
  hasNextPage?: boolean;
  className?: string;
  queryString?: string; // Additional query parameters to preserve
}

export function Pagination({
  currentPage,
  total = 0,
  pageSize = 10,
  totalPages,
  hasNextPage,
  className = '',
  queryString = '',
}: PaginationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const search: Record<string, string | undefined> = useSearch({
    strict: false,
  });
  const [loadingStates, setLoadingStates] = useState({
    prev: false,
    next: false,
  });
  const [, startTransition] = useTransition();

  useEffect(() => {
    setLoadingStates({
      prev: false,
      next: false,
    });
  }, [search, pathname]);

  const handlePageChange = (direction: 'prev' | 'next') => {
    const page = direction === 'prev' ? currentPage - 1 : currentPage + 1;
    if (page < 1) return;
    if (totalPages !== undefined && page > totalPages) return;
    if (direction === 'next' && hasNextPage === false) return;
    setLoadingStates((prev) => ({ ...prev, [direction]: true }));
    startTransition(() => {
      const newSearch = { ...search };

      // If additional query params are provided, ensure they're included
      if (queryString) {
        const additionalParams = new URLSearchParams(queryString);
        additionalParams.forEach((value, key) => {
          // Don't overwrite the page parameter that we're about to set
          if (key !== 'page') {
            newSearch[key] = value;
          }
        });
      }

      if (page === 1) {
        delete newSearch.page;
      } else {
        newSearch.page = page.toString();
      }

      void navigate({
        to: pathname,
        search: newSearch,
      });
    });
  };

  const handlePageSelect = (newPage: string) => {
    const page = parseInt(newPage);
    if (page < 1) return;
    if (totalPages !== undefined && page > totalPages) return;

    startTransition(() => {
      const newSearch = { ...search };

      // If additional query params are provided, ensure they're included
      if (queryString) {
        const additionalParams = new URLSearchParams(queryString);
        additionalParams.forEach((value, key) => {
          // Don't overwrite the page parameter that we're about to set
          if (key !== 'page') {
            newSearch[key] = value;
          }
        });
      }

      if (page === 1) {
        delete newSearch.page;
      } else {
        newSearch.page = page.toString();
      }

      void navigate({
        to: pathname,
        search: newSearch,
      });
    });
  };

  // Calculate range
  const isEmpty = total === 0;
  const startIdx = isEmpty ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, total);
  // Use provided totalPages or calculate from total and pageSize
  const totalPageCount = totalPages ?? Math.ceil(total / pageSize);
  // Disable next button if we're on the last page or hasNextPage is explicitly false
  const isNextDisabled = currentPage >= totalPageCount || hasNextPage === false;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => handlePageChange('prev')}
        disabled={
          isEmpty ||
          currentPage === 1 ||
          loadingStates.prev ||
          loadingStates.next
        }
        className="p-1.5"
      >
        {loadingStates.prev ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronLeft className="size-4" />
        )}
      </Button>

      <Select
        value={currentPage.toString()}
        onValueChange={handlePageSelect}
        disabled={isEmpty}
        className="h-8 w-auto min-w-16"
        placeholder="-"
        options={Array.from({ length: totalPageCount }, (_, i) => ({
          value: (i + 1).toString(),
          label: (i + 1).toString(),
        }))}
      />

      <Button
        variant="ghost"
        size="icon"
        onClick={() => handlePageChange('next')}
        disabled={
          isEmpty || isNextDisabled || loadingStates.prev || loadingStates.next
        }
        className="p-1.5"
      >
        {loadingStates.next ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </Button>

      <span className="text-muted-foreground text-xs font-semibold whitespace-nowrap">
        {isEmpty ? 'No items' : `${startIdx}-${endIdx} of ${total}`}
      </span>
    </div>
  );
}
