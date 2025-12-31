'use client';

/**
 * Specialized URL-based dialog state hook for data tables
 *
 * Features:
 * - Opens/closes dialogs based on URL params
 * - Preserves filter, pagination, and sorting params from useUrlFilters
 * - Non-blocking URL updates with useTransition
 * - Type-safe with generic item ID type
 */

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo, useTransition } from 'react';

export interface UseUrlDialogOptions {
  /** URL param key for the item ID (default: 'item') */
  paramKey?: string;
}

export interface UseUrlDialogReturn {
  /** Currently selected item ID from URL (null if dialog closed) */
  itemId: string | null;
  /** Whether dialog is open */
  isOpen: boolean;
  /** Open dialog for a specific item */
  openDialog: (id: string) => void;
  /** Close dialog */
  closeDialog: () => void;
  /** Whether URL update is pending */
  isPending: boolean;
}

/**
 * Hook for managing URL-synced dialog state in data tables
 *
 * Automatically preserves filter, pagination, and sorting params.
 *
 * @example
 * ```tsx
 * // In table component
 * const { itemId, isOpen, openDialog, closeDialog } = useUrlDialog({
 *   paramKey: 'customer',
 * });
 *
 * // Open dialog when row is clicked
 * const handleRowClick = (row: Row<Customer>) => {
 *   openDialog(row.original._id);
 * };
 *
 * // Dialog component
 * <CustomerDialog
 *   open={isOpen}
 *   customerId={itemId}
 *   onOpenChange={(open) => !open && closeDialog()}
 * />
 * ```
 */
export function useUrlDialog(options: UseUrlDialogOptions = {}): UseUrlDialogReturn {
  const { paramKey = 'item' } = options;

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Get current item ID from URL
  const itemId = useMemo(() => {
    return searchParams.get(paramKey);
  }, [searchParams, paramKey]);

  const isOpen = itemId !== null;

  // Open dialog - preserves all existing params
  const openDialog = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramKey, id);

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, paramKey, pathname, router],
  );

  // Close dialog - preserves all other params
  const closeDialog = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(paramKey);

    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    });
  }, [searchParams, paramKey, pathname, router]);

  return {
    itemId,
    isOpen,
    openDialog,
    closeDialog,
    isPending,
  };
}
