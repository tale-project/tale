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
 * Alternative validation result with single error
 */
export interface SimpleValidationResult {
  isValid: boolean;
  error: string | null;
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
 * Supported value types for rules and conditions
 */
export type SupportedValue = string | number | boolean | string[];

/**
 * Generic condition interface
 */
export interface BaseCondition {
  field: string;
  operator: string;
  value: SupportedValue;
}

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
