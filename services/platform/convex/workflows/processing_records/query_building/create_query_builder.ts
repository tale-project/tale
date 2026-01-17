/**
 * Create a query builder function for the given index and values.
 *
 * This function handles dynamic index selection at query time. It returns
 * a function that builds the actual query with the specified index and values.
 *
 * Note: We use `any` types here because Convex's type system requires
 * static knowledge of table and index names, but we're selecting these
 * dynamically based on the filter expression. The runtime behavior is
 * correct and validated by the index registry.
 *
 * @param ctx - Mutation context
 * @param tableName - The table to query
 * @param indexName - The index to use
 * @param indexValues - Field values for the index query
 * @returns Query builder function
 */

import type { MutationCtx } from '../../../_generated/server';
import type { TableName } from '../types';

export function createQueryBuilder(
  ctx: MutationCtx,
  tableName: TableName,
  indexName: string,
  indexValues: Record<string, unknown>,
) {
  return (resumeFrom: number | null) => {
    // Build the index query dynamically based on index values
    const query = ctx.db.query(tableName) as any;

    // Build the index query by applying each field value
    // The order of fields must match the index definition
    // Note: Object.entries preserves insertion order for string keys (ES2015+)
    // The caller (selectOptimalIndex) ensures indexValues has keys in index order
    const applyIndexFields = (q: any) => {
      let result = q;

      // Apply each field value in order (insertion order is guaranteed)
      for (const [field, value] of Object.entries(indexValues)) {
        result = result.eq(field, value);
      }

      // Apply resumeFrom if provided (for pagination)
      if (resumeFrom !== null) {
        result = result.gt('_creationTime', resumeFrom);
      }

      return result;
    };

    return query.withIndex(indexName, applyIndexFields).order('asc');
  };
}
