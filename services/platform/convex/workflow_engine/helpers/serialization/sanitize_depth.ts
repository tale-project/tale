/**
 * Depth sanitization utilities for workflow execution output
 *
 * The jsonValueValidator in Convex only supports ~8 levels of nesting depth.
 * Workflow executions can produce deeply nested output (customer data, loop state,
 * step outputs) that exceeds this limit.
 *
 * These utilities sanitize output by truncating deeply nested structures while
 * preserving the overall shape and as much data as possible.
 */

/**
 * Safe depth limit for inline storage.
 * jsonValueValidator supports ~8 levels; use 6 for safety margin.
 */
export const MAX_SAFE_DEPTH = 6;

export interface TruncationMarker {
  _truncated: true;
  _originalType: 'array' | 'object';
  _itemCount?: number;
  _stringified?: string;
}

/**
 * Sanitize a value by capping nesting depth.
 *
 * When depth exceeds the limit, replaces the value with a truncation marker.
 * This ensures compatibility with jsonValueValidator's depth limit.
 *
 * @param value - The value to sanitize
 * @param currentDepth - Current depth level (internal use)
 * @param maxDepth - Maximum allowed depth (default: MAX_SAFE_DEPTH)
 * @returns Sanitized value with truncation markers at excessive depths
 */
export function sanitizeDepth(
  value: unknown,
  currentDepth = 0,
  maxDepth = MAX_SAFE_DEPTH,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (currentDepth >= maxDepth) {
    let stringified: string | undefined;
    try {
      stringified = JSON.stringify(value);
    } catch {
      // Circular references or other serialization failures — skip
    }

    if (Array.isArray(value)) {
      return {
        _truncated: true,
        _originalType: 'array',
        _itemCount: value.length,
        ...(stringified ? { _stringified: stringified } : {}),
      } as TruncationMarker;
    }
    return {
      _truncated: true,
      _originalType: 'object',
      ...(stringified ? { _stringified: stringified } : {}),
    } as TruncationMarker;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDepth(item, currentDepth + 1, maxDepth));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = sanitizeDepth(val, currentDepth + 1, maxDepth);
  }
  return result;
}

/**
 * Calculate the maximum nesting depth of a value.
 *
 * @param value - The value to measure
 * @param currentDepth - Current depth level (internal use)
 * @returns Maximum nesting depth (0 for primitives)
 */
export function calculateDepth(value: unknown, currentDepth = 0): number {
  if (value === null || value === undefined || typeof value !== 'object') {
    return currentDepth;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return currentDepth + 1;
    return Math.max(
      ...value.map((item) => calculateDepth(item, currentDepth + 1)),
    );
  }

  const entries = Object.values(value);
  if (entries.length === 0) return currentDepth + 1;
  return Math.max(
    ...entries.map((val) => calculateDepth(val, currentDepth + 1)),
  );
}
