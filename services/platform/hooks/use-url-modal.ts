'use client';

/**
 * Specialized URL-based modal state hook for data tables
 *
 * Features:
 * - Opens/closes modals based on URL params
 * - Preserves filter, pagination, and sorting params from useUrlFilters
 * - Non-blocking URL updates with useTransition
 * - Type-safe with generic item ID type
 */

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo, useTransition } from 'react';

export interface UseUrlModalOptions {
  /** URL param key for the item ID (default: 'item') */
  paramKey?: string;
}

export interface UseUrlModalReturn {
  /** Currently selected item ID from URL (null if modal closed) */
  itemId: string | null;
  /** Whether modal is open */
  isOpen: boolean;
  /** Open modal for a specific item */
  openModal: (id: string) => void;
  /** Close modal */
  closeModal: () => void;
  /** Whether URL update is pending */
  isPending: boolean;
}

/**
 * Hook for managing URL-synced modal state in data tables
 *
 * Automatically preserves filter, pagination, and sorting params.
 *
 * @example
 * ```tsx
 * // In table component
 * const { itemId, isOpen, openModal, closeModal } = useUrlModal({
 *   paramKey: 'customer',
 * });
 *
 * // Open modal when row is clicked
 * const handleRowClick = (row: Row<Customer>) => {
 *   openModal(row.original._id);
 * };
 *
 * // Modal component
 * <CustomerModal
 *   open={isOpen}
 *   customerId={itemId}
 *   onOpenChange={(open) => !open && closeModal()}
 * />
 * ```
 */
export function useUrlModal(options: UseUrlModalOptions = {}): UseUrlModalReturn {
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

  // Open modal - preserves all existing params
  const openModal = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(paramKey, id);

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, paramKey, pathname, router],
  );

  // Close modal - preserves all other params
  const closeModal = useCallback(() => {
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
    openModal,
    closeModal,
    isPending,
  };
}
