/**
 * Query Building
 *
 * Handles building database queries with smart index selection and post-filtering:
 * 1. Selects optimal index based on filter expression
 * 2. Builds dynamic queries using the selected index
 * 3. Creates post-filters for complex conditions
 * 4. Finds and claims unprocessed documents
 *
 * Each function is in its own file following the one-function-per-file principle.
 */

// Export types
export type { FindUnprocessedArgs, FindUnprocessedResult } from './types';

// Export functions
export { createQueryBuilder } from './create_query_builder';
export { createExpressionFilter } from './create_expression_filter';
export { findUnprocessed } from './find_unprocessed';
