'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { entityLabelForms, type EntityLabel } from './data-table-types';

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
  /** Entity noun. Enables noun-rich copy like "Showing 1-25 of 100 agents" — pass `{ one, other }` so a single-item total reads correctly too. */
  entityLabel?: EntityLabel;
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
  entityLabel,
}: DataTablePaginationProps) {
  const { t } = useT('common');

  // Calculate range
  const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, total);

  // Use provided totalPages or calculate from total and pageSize
  const totalPageCount = totalPages ?? Math.ceil(total / pageSize);

  // When everything fits on a single page there's nothing to navigate, so the
  // page-size selector, prev/next buttons and page dropdown are just noise
  // (e.g. a 1-member org). Collapse them to the bare count. Guard against
  // cursor-based pagination (unknown total) where neighbours still exist.
  const isSinglePage =
    totalPageCount <= 1 && hasNextPage !== true && hasPreviousPage !== true;

  // Determine if buttons should be disabled
  const isPrevDisabled =
    isLoading || currentPage === 1 || hasPreviousPage === false;
  const isNextDisabled =
    isLoading || currentPage >= totalPageCount || hasNextPage === false;

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
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 sm:justify-start',
        className,
      )}
    >
      {!isSinglePage && showPageSizeSelector && onPageSizeChange && (
        <div className="mr-4 hidden items-center gap-2 sm:flex">
          <Text as="span" variant="caption">
            {t('pagination.rowsPerPage')}
          </Text>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(parseInt(value, 10))}
            className="h-8 w-auto min-w-16"
            aria-label={t('pagination.rowsPerPage')}
            options={pageSizeOptions.map((size) => ({
              value: size.toString(),
              label: size.toString(),
            }))}
          />
        </div>
      )}

      {!isSinglePage && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePrevious}
          disabled={isPrevDisabled}
          className="p-1.5"
          title={t('aria.previousPage')}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>
      )}

      {!isSinglePage && totalPageCount > 0 && (
        <Select
          value={currentPage.toString()}
          onValueChange={handlePageSelect}
          className="h-8 w-auto min-w-16"
          aria-label={t('aria.goToPage')}
          options={Array.from({ length: totalPageCount }, (_, i) => ({
            value: (i + 1).toString(),
            label: (i + 1).toString(),
          }))}
        />
      )}

      {!isSinglePage && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNext}
          disabled={isNextDisabled}
          className="p-1.5"
          title={t('aria.nextPage')}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      )}

      {total > 0 && (
        <Text
          as="span"
          variant="caption"
          className="hidden font-semibold whitespace-nowrap sm:inline"
        >
          {entityLabel
            ? t('pagination.showingRange', {
                start: startIdx,
                end: endIdx,
                total,
                ...entityLabelForms(entityLabel),
              })
            : t('pagination.showing', {
                start: startIdx,
                end: endIdx,
                total,
              })}
        </Text>
      )}
    </div>
  );
}
