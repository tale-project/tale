/**
 * Skeleton Components for Self-Contained Loading States
 *
 * These skeleton components provide consistent loading UI throughout the app.
 * They match the visual design of the actual components they replace.
 *
 * ## Usage:
 *
 * For tables, prefer using DataTableSkeleton from the data-table component:
 *
 * ```tsx
 * import { AsyncBoundary } from '@/components/async-boundary';
 * import { DataTableSkeleton } from '@/components/ui/data-table';
 *
 * // Self-contained loading - the skeleton is built into the boundary
 * <AsyncBoundary fallback={<DataTableSkeleton rows={10} />}>
 *   <CustomersTable />
 * </AsyncBoundary>
 * ```
 *
 * ## Performance Impact:
 * - Skeletons prevent layout shift (CLS) by matching component dimensions
 * - They enable streaming by providing immediate visual feedback
 * - Users perceive faster load times due to progressive rendering
 *
 * @module
 */

/**
 * @deprecated Use DataTableSkeleton from '@/components/ui/data-table' instead
 */
export { TableSkeleton, TableRowSkeleton } from './table-skeleton';
export { CardSkeleton, CardGridSkeleton } from './card-skeleton';
export {
  NavigationSkeleton,
  TabNavigationSkeleton,
} from './navigation-skeleton';
export { PageHeaderSkeleton } from './page-header-skeleton';
export { FormSkeleton } from './form-skeleton';
export { ListSkeleton, ListItemSkeleton } from './list-skeleton';
