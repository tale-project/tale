import { AppError } from '../../lib/shared/errors/app-error';

/**
 * Maximum length of a product name (characters).
 *
 * Products allow a longer name than knowledge-entry topics
 * (`TOPIC_MAX_LENGTH = 120`) because a product name often carries variant /
 * model / packaging detail (e.g. `Brand X Pro 15" Laptop, 32GB RAM, Space
 * Gray`); 200 keeps a sane upper bound without truncating realistic catalog
 * names.
 */
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
 * Throws a `AppError` with `code: 'validation'` (rather than a plain
 * `Error`) so the REST wrapper (`withRestAuth`) maps it to an HTTP 400 instead
 * of an opaque 500 — products are REST-exposed, unlike knowledge entries.
 *
 * @returns the trimmed name to persist.
 * @throws {AppError} if the name is empty/whitespace-only or exceeds the max length.
 */
export function validateProductName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError({
      code: 'validation',
      message: 'Product name is required',
      userMessage: 'Product name is required.',
    });
  }
  if (trimmed.length > PRODUCT_NAME_MAX_LENGTH) {
    throw new AppError({
      code: 'validation',
      message: `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters`,
      userMessage: `Product name exceeds ${PRODUCT_NAME_MAX_LENGTH} characters.`,
    });
  }
  return trimmed;
}
