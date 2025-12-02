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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  }, [searchParams, pathname]);

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

  const handlePageSelect = (newPage: string) => {
    const page = parseInt(newPage);
    if (page < 1) return;
    if (totalPages !== undefined && page > totalPages) return;

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

      <Select value={currentPage.toString()} onValueChange={handlePageSelect}>
        <SelectTrigger className="w-auto min-w-16 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-auto min-w-20">
          {Array.from({ length: totalPageCount }, (_, i) => i + 1).map(
            (page) => (
              <SelectItem key={page} value={page.toString()}>
                {page}
              </SelectItem>
            ),
          )}
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
