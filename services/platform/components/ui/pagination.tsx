'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  total?: number;
  pageSize?: number; // Used for pagination calculations and dynamic size options
  totalPages?: number; // Optional, for compatibility
  hasNextPage?: boolean;
  className?: string;
  queryString?: string; // Additional query parameters to preserve
}

export default function Pagination({
  currentPage,
  total = 0,
  pageSize = 10,
  totalPages,
  hasNextPage,
  className = '',
  queryString = '',
}: PaginationProps) {
  const PAGE_SIZE_OPTIONS = generatePageSizeOptions(pageSize, total);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loadingStates, setLoadingStates] = useState({
    prev: false,
    next: false,
  });
  const [selectedPageSize, setSelectedPageSize] = useState(pageSize.toString());
  const [, startTransition] = useTransition();

  useEffect(() => {
    setLoadingStates({
      prev: false,
      next: false,
    });
  }, [searchParams, pathname]);

  // Sync selected option whenever the pageSize prop changes
  useEffect(() => {
    setSelectedPageSize(pageSize.toString());
  }, [pageSize]);

  const handlePageChange = (direction: 'prev' | 'next') => {
    const page = direction === 'prev' ? currentPage - 1 : currentPage + 1;
    if (page < 1) return;
    if (totalPages !== undefined && page > totalPages) return;
    if (direction === 'next' && hasNextPage === false) return;
    setLoadingStates((prev) => ({ ...prev, [direction]: true }));
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());

      // If additional query params are provided, ensure they're included
      if (queryString) {
        const additionalParams = new URLSearchParams(queryString);
        additionalParams.forEach((value, key) => {
          // Don't overwrite the page parameter that we're about to set
          if (key !== 'page') {
            params.set(key, value);
          }
        });
      }

      if (page === 1) {
        params.delete('page');
        router.push(
          `${pathname}${params.toString() ? `?${params.toString()}` : ''}`,
        );
      } else {
        params.set('page', page.toString());
        router.push(`${pathname}?${params.toString()}`);
      }
    });
  };

  const handleSizeChange = (newSize: string) => {
    // Update local state immediately for UI feedback
    setSelectedPageSize(newSize);

    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());

      // If additional query params are provided, ensure they're included
      if (queryString) {
        const additionalParams = new URLSearchParams(queryString);
        additionalParams.forEach((value, key) => {
          // Don't overwrite the page or size parameters
          if (key !== 'page' && key !== 'size') {
            params.set(key, value);
          }
        });
      }

      // Reset to page 1 when changing page size
      params.delete('page');

      // Set or remove the size parameter
      if (newSize === pageSize.toString()) {
        params.delete('size');
      } else {
        params.set('size', newSize);
      }
    });
  };

  // Calculate range
  const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
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
        disabled={currentPage === 1 || loadingStates.prev || loadingStates.next}
        className="p-1.5"
      >
        {loadingStates.prev ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronLeft className="size-4" />
        )}
      </Button>

      <Select value={selectedPageSize} onValueChange={handleSizeChange}>
        <SelectTrigger className="w-auto min-w-16 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-auto min-w-20">
          {PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={size.toString()}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => handlePageChange('next')}
        disabled={isNextDisabled || loadingStates.prev || loadingStates.next}
        className="p-1.5"
      >
        {loadingStates.next ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </Button>

      <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
        {`${startIdx}-${endIdx} of ${total}`}
      </span>
    </div>
  );
}

const DEFAULT_MIN_OPTIONS = 5;
const DEFAULT_MAX_OPTIONS = 10;

const generatePageSizeOptions = (
  pageSize: number,
  total: number,
  minOptions = DEFAULT_MIN_OPTIONS,
  maxOptions = DEFAULT_MAX_OPTIONS,
) => {
  const options: number[] = [];

  // Generate multiples of pageSize
  for (let i = 1; i <= maxOptions; i++) {
    const size = pageSize * i;
    if (size > total) break;
    options.push(size);
  }

  // Ensure we return at least 1 value (pageSize)
  if (options.length === 0) {
    options.push(pageSize);
  }

  // Ensure at least minOptions if possible
  while (
    options.length < minOptions &&
    options[options.length - 1] + pageSize <= total
  ) {
    options.push(options[options.length - 1] + pageSize);
  }

  return options;
};
