'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface DataTablePaginationProps {
  /** Current page number (1-based) */
  currentPage: number;
  /** Total number of items */
  total?: number;
  /** Number of items per page */
  pageSize?: number;
  /** Total number of pages (optional, calculated from total/pageSize if not provided) */
  totalPages?: number;
  /** Whether there's a next page (for cursor-based pagination) */
  hasNextPage?: boolean;
  /** Whether there's a previous page (for cursor-based pagination) */
  hasPreviousPage?: boolean;
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Whether pagination is loading */
  isLoading?: boolean;
  /** Additional class name */
  className?: string;
  /** Whether to show page size selector */
  showPageSizeSelector?: boolean;
  /** Available page sizes */
  pageSizeOptions?: number[];
  /** Callback when page size changes */
  onPageSizeChange?: (pageSize: number) => void;
}

/**
 * Pagination component for DataTable.
 * 
 * Supports both traditional pagination (with total count) and
 * cursor-based pagination (with hasNextPage/hasPreviousPage).
 */
export function DataTablePagination({
  currentPage,
  total = 0,
  pageSize = 10,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onPageChange,
  isLoading = false,
  className,
  showPageSizeSelector = false,
  pageSizeOptions = [10, 20, 50, 100],
  onPageSizeChange,
}: DataTablePaginationProps) {
  // Calculate range
  const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, total);
  
  // Use provided totalPages or calculate from total and pageSize
  const totalPageCount = totalPages ?? Math.ceil(total / pageSize);
  
  // Determine if buttons should be disabled
  const isPrevDisabled =
    isLoading || currentPage === 1 || (hasPreviousPage === false);
  const isNextDisabled =
    isLoading ||
    currentPage >= totalPageCount ||
    hasNextPage === false;

  const handlePrevious = () => {
    if (!isPrevDisabled && onPageChange) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (!isNextDisabled && onPageChange) {
      onPageChange(currentPage + 1);
    }
  };

  const handlePageSelect = (value: string) => {
    const page = parseInt(value, 10);
    if (!isNaN(page) && onPageChange) {
      onPageChange(page);
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showPageSizeSelector && onPageSizeChange && (
        <div className="flex items-center gap-2 mr-4">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(parseInt(value, 10))}
          >
            <SelectTrigger className="w-auto min-w-16 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevious}
        disabled={isPrevDisabled}
        className="p-1.5"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronLeft className="size-4" />
        )}
      </Button>

      {totalPageCount > 0 && (
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
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={handleNext}
        disabled={isNextDisabled}
        className="p-1.5"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </Button>

      {total > 0 && (
        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
          {`${startIdx}-${endIdx} of ${total}`}
        </span>
      )}
    </div>
  );
}

