import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TableRowSkeletonProps {
  columns?: number;
}

/**
 * A single skeleton table row.
 * Useful for inline loading states within existing tables.
 */
export function TableRowSkeleton({ columns = 5 }: TableRowSkeletonProps) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  );
}

interface TableSkeletonProps {
  /** Number of rows to display */
  rows?: number;
  /** Number of columns to display */
  columns?: number;
  /** Column header labels (optional - shows skeleton if not provided) */
  headers?: string[];
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Full table skeleton with optional headers.
 *
 * ## Example:
 * ```tsx
 * <TableSkeleton rows={10} columns={6} headers={['Name', 'Status', 'Created']} />
 * ```
 *
 * ## Performance Impact:
 * - Prevents CLS by maintaining table dimensions during load
 * - Uses CSS animation for smooth visual feedback
 */
export function TableSkeleton({
  rows = 5,
  columns = 5,
  headers,
  showHeader = true,
  className,
}: TableSkeletonProps) {
  const effectiveColumns = headers?.length ?? columns;

  return (
    <div className={className}>
      <Table>
        {showHeader && (
          <TableHeader>
            <TableRow className="bg-secondary/20">
              {Array.from({ length: effectiveColumns }).map((_, i) => (
                <TableHead key={i} className="font-medium text-sm">
                  {headers?.[i] ?? <Skeleton className="h-4 w-20" />}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: effectiveColumns }).map((_, colIndex) => (
                <TableCell key={colIndex}>
                  {colIndex === 0 ? (
                    // First column often has name + subtitle
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ) : colIndex === effectiveColumns - 1 ? (
                    // Last column often has actions
                    <div className="flex justify-end">
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  ) : (
                    <Skeleton className="h-4 w-full max-w-[120px]" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

