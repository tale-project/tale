'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useState,
  Children,
  isValidElement,
  cloneElement,
  createElement,
  type ReactNode,
  type ReactElement,
} from 'react';

import { TableBody, TableCell } from '@/app/components/ui/data-display/table';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';

interface PaginatedMarkdownTableProps {
  children?: ReactNode;
  pageSize?: number;
}

export function PaginatedMarkdownTable({
  children,
  pageSize = 10,
}: PaginatedMarkdownTableProps) {
  const { t } = useT('common');
  const [currentPage, setCurrentPage] = useState(1);

  // Extract thead and tbody from children using find() instead of forEach()
  // to avoid TypeScript narrowing issues with let mutations inside callbacks
  const childArray = Children.toArray(children).filter(isValidElement);

  const getDisplayName = (childType: ReactElement['type']) =>
    typeof childType === 'function' || typeof childType === 'object'
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- React component types don't expose displayName in TS
        ((childType as { displayName?: string }).displayName ?? null)
      : null;

  const thead =
    childArray.find((child) => {
      const displayName = getDisplayName(child.type);
      return displayName === 'TableHeader' || child.type === 'thead';
    }) ?? null;

  const tbodyChild = childArray.find((child) => {
    const displayName = getDisplayName(child.type);
    return (
      displayName === 'TableBody' ||
      child.type === 'tbody' ||
      child.type === TableBody
    );
  });

  const tbodyRows = tbodyChild
    ? Children.toArray(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ReactElement.props is untyped for generic elements
        (tbodyChild.props as { children?: ReactNode }).children,
      ).filter(isValidElement)
    : [];

  // Count columns in header to normalize rows
  let headerColumnCount = 0;
  if (thead) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ReactElement.props is untyped for generic elements
    const theadProps = thead.props as { children?: ReactNode };
    Children.forEach(theadProps.children, (headerRow) => {
      if (isValidElement(headerRow)) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ReactElement.props is untyped for generic elements
        const rowProps = headerRow.props as { children?: ReactNode };
        headerColumnCount = Children.count(rowProps.children);
      }
    });
  }

  // Helper function to normalize a row to have the expected number of columns
  const normalizeRow = (
    row: ReactElement,
    expectedColumns: number,
  ): ReactElement => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ReactElement.props is untyped for generic elements
    const rowProps = row.props as { children?: ReactNode };
    const cells = Children.toArray(rowProps.children);
    const currentCount = cells.length;

    if (currentCount >= expectedColumns) {
      return row;
    }

    // Add empty cells to match expected column count
    const emptyCells = Array.from(
      { length: expectedColumns - currentCount },
      (_, i) => createElement(TableCell, { key: `empty-${i}` }, '-'),
    );

    return cloneElement(row, {}, [...cells, ...emptyCells]);
  };

  // Normalize all rows to have consistent column counts
  const normalizedRows =
    headerColumnCount > 0
      ? tbodyRows.map((row) => normalizeRow(row, headerColumnCount))
      : tbodyRows;

  const totalRows = normalizedRows.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const paginatedRows = normalizedRows.slice(startIdx, endIdx);

  // Only show pagination if there are more rows than pageSize
  const showPagination = totalRows > pageSize;

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  };

  const handlePageSelect = (value: string) => {
    setCurrentPage(parseInt(value, 10));
  };

  // Clone tbody with paginated rows
  // When pagination is shown, ensure last row keeps its bottom border
  const paginatedTbody = (
    <TableBody
      className={showPagination ? '[&_tr:last-child]:border-b' : undefined}
    >
      {paginatedRows.map((row, index) =>
        cloneElement(row, { key: row.key ?? index }),
      )}
    </TableBody>
  );

  return (
    <div className="border-border my-4 max-w-(--chat-max-width) overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          {thead}
          {paginatedTbody}
        </table>
      </div>

      {showPagination && (
        <div className="border-border bg-background flex items-center gap-5 border-t p-2">
          <div className="flex items-center gap-3">
            {/* Previous button */}
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('aria.previousPage')}
            >
              <ChevronLeft className="size-5" />
            </button>

            {/* Page selector dropdown */}
            <Select
              value={currentPage.toString()}
              onValueChange={handlePageSelect}
              className="text-muted-foreground h-7 w-auto min-w-[2.5rem] gap-1 px-2 py-1.5 text-sm font-medium"
              options={Array.from({ length: totalPages }, (_, i) => ({
                value: (i + 1).toString(),
                label: (i + 1).toString(),
              }))}
            />

            {/* Next button */}
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('aria.nextPage')}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Page info text */}
          <span className="text-muted-foreground text-xs font-medium whitespace-nowrap">
            {t('pagination.showing', {
              start: startIdx + 1,
              end: endIdx,
              total: totalRows,
            })}
          </span>
        </div>
      )}
    </div>
  );
}
