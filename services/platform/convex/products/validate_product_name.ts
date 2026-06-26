/** Maximum length of a product name (characters). */
export const PRODUCT_NAME_MAX_LENGTH = 200;

/**
 * Validate and normalize a product name on the write path.
 *
 * Convex `v.string()` cannot express a non-empty constraint, and the
 * product create/edit dialogs only trim + require the name client-side, so
 * non-UI callers (REST API, the agent product-write tool, the workflow-engine
 * product action) can otherwise persist an empty or whitespace-only name.
 * This mirrors `validateTopicAndContent` for knowledge entries: trim, reject
 * empty, and cap the length.
 *
 * @returns the trimmed name to persist.
 * @throws if the name is empty/whitespace-only or exceeds the max length.
 */
export function validateProductName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Product name is required');
  }
  if (trimmed.length > PRODUCT_NAME_MAX_LENGTH) {
    throw new Error(
      `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}
