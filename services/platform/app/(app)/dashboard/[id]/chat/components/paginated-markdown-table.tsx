'use client';

import {
  useState,
  Children,
  isValidElement,
  cloneElement,
  createElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { TableBody, TableCell } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface PaginatedMarkdownTableProps {
  children?: ReactNode;
  pageSize?: number;
}

export default function PaginatedMarkdownTable({
  children,
  pageSize = 10,
}: PaginatedMarkdownTableProps) {
  const { t } = useT('common');
  const [currentPage, setCurrentPage] = useState(1);

  // Extract thead and tbody from children
  let thead: ReactElement | null = null;
  let tbodyRows: ReactElement[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    // Check for thead (rendered as TableHeader by react-markdown component mapping)
    const childType = child.type;
    const displayName =
      typeof childType === 'function' || typeof childType === 'object'
        ? (childType as { displayName?: string }).displayName
        : null;

    if (displayName === 'TableHeader' || childType === 'thead') {
      thead = child;
    }
    // Check for tbody (rendered as TableBody by react-markdown component mapping)
    else if (
      displayName === 'TableBody' ||
      childType === 'tbody' ||
      childType === TableBody
    ) {
      // Extract rows from tbody
      const childProps = child.props as { children?: ReactNode };
      const tbodyChildren = Children.toArray(childProps.children);
      tbodyRows = tbodyChildren.filter(isValidElement) as ReactElement[];
    }
  });

  // Count columns in header to normalize rows
  let headerColumnCount = 0;
  if (thead) {
    const theadProps = (thead as ReactElement).props as { children?: ReactNode };
    Children.forEach(theadProps.children, (headerRow) => {
      if (isValidElement(headerRow)) {
        const rowProps = headerRow.props as { children?: ReactNode };
        headerColumnCount = Children.count(rowProps.children);
      }
    });
  }

  // Helper function to normalize a row to have the expected number of columns
  const normalizeRow = (row: ReactElement, expectedColumns: number): ReactElement => {
    const rowProps = row.props as { children?: ReactNode };
    const cells = Children.toArray(rowProps.children);
    const currentCount = cells.length;

    if (currentCount >= expectedColumns) {
      return row;
    }

    // Add empty cells to match expected column count
    const emptyCells = Array.from(
      { length: expectedColumns - currentCount },
      (_, i) => createElement(TableCell, { key: `empty-${i}` }, '-')
    );

    return cloneElement(row, {}, [...cells, ...emptyCells]);
  };

  // Normalize all rows to have consistent column counts
  const normalizedRows = headerColumnCount > 0
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
    <div className="overflow-hidden rounded-lg border border-border my-4 max-w-[var(--chat-max-width)]">
      <div className="overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          {thead}
          {paginatedTbody}
        </table>
      </div>

      {showPagination && (
        <div className="flex items-center gap-5 p-2 border-t border-border bg-background">
          <div className="flex items-center gap-3">
            {/* Previous button */}
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={t('aria.previousPage')}
            >
              <ChevronLeft className="size-5" />
            </button>

            {/* Page selector dropdown */}
            <Select
              value={currentPage.toString()}
              onValueChange={handlePageSelect}
            >
              <SelectTrigger className="h-7 w-auto min-w-[2.5rem] px-2 py-1.5 gap-1 text-sm font-medium text-muted-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-[3rem]">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <SelectItem key={page} value={page.toString()}>
                      {page}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>

            {/* Next button */}
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={t('aria.nextPage')}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Page info text */}
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
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
