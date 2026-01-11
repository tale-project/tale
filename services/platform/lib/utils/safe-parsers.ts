/**
 * Safe parsing utilities for metadata, JSON, and complex data structures.
 *
 * These functions prevent runtime errors from malformed or unexpected data
 * by providing type-safe extraction with fallback values.
 *
 * Used primarily in:
 * - Approvals metadata parsing
 * - Complex table cell renderers
 * - API response handling
 *
 * @example
 * const metadata = approval.metadata as unknown;
 * const customerName = safeGetString(metadata, 'customerName', 'Unknown');
 * const products = safeParseProductList(metadata.recommendedProducts);
 */

/**
 * Safely extract a string value from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback value if extraction fails
 * @returns The string value or fallback
 */
export function safeGetString(obj: unknown, key: string, fallback = ''): string {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Safely extract a number value from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback value if extraction fails
 * @returns The number value or fallback
 */
export function safeGetNumber(
  obj: unknown,
  key: string,
  fallback?: number
): number | undefined {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Safely extract a boolean value from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback value if extraction fails
 * @returns The boolean value or fallback
 */
export function safeGetBoolean(
  obj: unknown,
  key: string,
  fallback = false
): boolean {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Safely extract an array from an object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Fallback array if extraction fails
 * @returns The array value or fallback
 */
export function safeGetArray<T>(
  obj: unknown,
  key: string,
  fallback: T[] = []
): T[] {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const value = (obj as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as T[]) : fallback;
}

/**
 * Safely parse JSON with fallback.
 *
 * @param json - JSON string to parse
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed value or fallback
 */
export function safeParseJSON<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safely parse a product list from metadata.
 *
 * Used in approvals table for recommended products and event products.
 *
 * @param products - Unknown products data
 * @returns Array of parsed products with safe fallbacks
 */
export function safeParseProductList(products: unknown): Array<{
  id: string;
  name: string;
  image: string;
  confidence?: number;
  relationshipType?: string;
  reasoning?: string;
}> {
  const list = Array.isArray(products) ? products : [];
  return list.map((product, index) => ({
    id:
      safeGetString(product, 'productId') ||
      safeGetString(product, 'id', `product-${index}`),
    name:
      safeGetString(product, 'productName') ||
      safeGetString(product, 'name', ''),
    image:
      safeGetString(product, 'imageUrl') ||
      safeGetString(product, 'image', '/assets/placeholder-image.png'),
    confidence: safeGetNumber(product, 'confidence'),
    relationshipType: safeGetString(product, 'relationshipType') || undefined,
    reasoning: safeGetString(product, 'reasoning') || undefined,
  }));
}

/**
 * Safely parse previous purchases from event products metadata.
 *
 * @param eventProducts - Unknown event products data
 * @returns Array of parsed previous purchases
 */
export function safeParsePreviousPurchases(eventProducts: unknown): Array<{
  id: string;
  productName: string;
  image: string;
  purchaseDate?: string;
  status?: 'active' | 'cancelled';
}> {
  const list = Array.isArray(eventProducts) ? eventProducts : [];
  return list.map((product, index) => {
    const status = safeGetString(product, 'status');
    return {
      id: safeGetString(product, 'id', `prev-${index}`),
      productName:
        safeGetString(product, 'productName') ||
        safeGetString(product, 'name') ||
        safeGetString(product, 'product_name', ''),
      image:
        safeGetString(product, 'image') ||
        safeGetString(product, 'imageUrl') ||
        safeGetString(product, 'image_url', '/assets/placeholder-image.png'),
      purchaseDate: safeGetString(product, 'purchaseDate') || undefined,
      status:
        status === 'active' || status === 'cancelled'
          ? (status as 'active' | 'cancelled')
          : undefined,
    };
  });
}

/**
 * Safely convert confidence value to percentage.
 *
 * Handles both decimal (0-1) and percentage (0-100) formats.
 *
 * @param value - Confidence value to convert
 * @returns Confidence as percentage or undefined
 */
export function safeConfidenceToPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}
