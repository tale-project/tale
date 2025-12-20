/**
 * Skeleton Components for Self-Contained Loading States
 *
 * These skeleton components provide consistent loading UI throughout the app.
 * They match the visual design of the actual components they replace.
 *
 * ## Usage:
 *
 * Use with the AsyncBoundary pattern for self-contained loading:
 *
 * ```tsx
 * import { AsyncBoundary } from '@/components/async-boundary';
 * import { TableSkeleton } from '@/components/skeletons';
 *
 * // Self-contained loading - the skeleton is built into the boundary
 * <AsyncBoundary fallback={<TableSkeleton rows={10} />}>
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

export { TableSkeleton, TableRowSkeleton } from './table-skeleton';
export { CardSkeleton, CardGridSkeleton } from './card-skeleton';
export { NavigationSkeleton } from './navigation-skeleton';
export { PageHeaderSkeleton } from './page-header-skeleton';
export { FormSkeleton } from './form-skeleton';
export { ListSkeleton, ListItemSkeleton } from './list-skeleton';

