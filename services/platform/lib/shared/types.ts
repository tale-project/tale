/**
 * Shared Type Definitions
 * Contains common types used across multiple modules
 */

/**
 * Generic validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Generic operation result type using discriminated union
 * Prevents contradictory states by ensuring success: true has data
 * and success: false has error information
 */
export type OperationResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; errors?: string[] };

/**
 * Standard pagination interface used across the application
 * Contains page information, limits, and totals for paginated data
 *
 * @example
 * ```typescript
 * import { Pagination } from '@/lib/shared/types';
 *
 * interface ApiResponse {
 *   data: MyData[];
 *   pagination: Pagination;
 * }
 *
 * const response: ApiResponse = {
 *   data: [...],
 *   pagination: {
 *     page: 1,
 *     limit: 20,
 *     total: 100,
 *     totalPages: 5
 *   }
 * };
 * ```
 */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
