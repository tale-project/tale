/**
 * Server-side URL state parsing utilities
 *
 * Used in Server Components to parse searchParams for SSR of panels and modals
 */

export type UrlStateValue = string | null;

export interface UrlStateDefinition {
  /** URL param key (defaults to the state key) */
  urlKey?: string;
  /** Default value when param is not in URL */
  default?: UrlStateValue;
}

export type UrlStateDefinitions = Record<string, UrlStateDefinition>;

export type ParsedUrlState<T extends UrlStateDefinitions> = {
  [K in keyof T]: UrlStateValue;
};

/**
 * Parse URL state from Next.js searchParams
 *
 * @example
 * ```ts
 * // In Server Component
 * const panelState = parseUrlState(await searchParams, {
 *   panel: { default: null },
 *   step: { default: null },
 * });
 *
 * // panelState.panel is 'ai-chat' | 'test' | 'step' | null
 * // panelState.step is the step slug or null
 * ```
 */
export function parseUrlState<T extends UrlStateDefinitions>(
  searchParams: Record<string, string | string[] | undefined>,
  definitions: T,
): ParsedUrlState<T> {
  const result = {} as ParsedUrlState<T>;

  for (const [key, definition] of Object.entries(definitions)) {
    const urlKey = definition.urlKey ?? key;
    const rawValue = searchParams[urlKey];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    (result as Record<string, UrlStateValue>)[key] = value ?? definition.default ?? null;
  }

  return result;
}

/**
 * Check if any URL state values are set (non-null and non-default)
 */
export function hasUrlState<T extends UrlStateDefinitions>(
  state: ParsedUrlState<T>,
  definitions: T,
): boolean {
  for (const [key, definition] of Object.entries(definitions)) {
    const value = state[key as keyof T];
    if (value !== null && value !== definition.default) {
      return true;
    }
  }
  return false;
}

/**
 * Get a single URL state value from searchParams
 *
 * @example
 * ```ts
 * const itemId = getUrlStateValue(searchParams, 'item');
 * if (itemId) {
 *   // Preload item data for SSR
 * }
 * ```
 */
export function getUrlStateValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
  defaultValue: UrlStateValue = null,
): UrlStateValue {
  const rawValue = searchParams[key];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return value ?? defaultValue;
}
