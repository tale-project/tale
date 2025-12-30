'use client';

/**
 * Generic URL-based state management hook
 *
 * Features:
 * - Syncs any key-value state to URL search params
 * - Uses useTransition for non-blocking URL updates
 * - Preserves existing URL params (filters, pagination, etc.)
 * - Type-safe with generics
 * - Supports SSR with initial values from server
 */

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo, useTransition } from 'react';

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

export interface UseUrlStateOptions<T extends UrlStateDefinitions> {
  /** State definitions */
  definitions: T;
  /** Keys to preserve when updating (e.g., filter params from useUrlFilters) */
  preserveKeys?: string[];
  /** Initial values from server (for SSR hydration) */
  initialValues?: Partial<ParsedUrlState<T>>;
}

export interface UseUrlStateReturn<T extends UrlStateDefinitions> {
  /** Current state values from URL */
  state: ParsedUrlState<T>;
  /** Set a single state value */
  setState: <K extends keyof T>(key: K, value: UrlStateValue) => void;
  /** Set multiple state values at once */
  setStates: (values: Partial<ParsedUrlState<T>>) => void;
  /** Clear specific keys (set to null/remove from URL) */
  clearState: (...keys: Array<keyof T>) => void;
  /** Clear all managed state */
  clearAll: () => void;
  /** Whether update is pending */
  isPending: boolean;
}

/**
 * Hook for managing URL-synced state
 *
 * @example
 * ```tsx
 * const { state, setState, clearState } = useUrlState({
 *   definitions: {
 *     panel: { default: null },
 *     step: { default: null },
 *   },
 * });
 *
 * // Open AI chat panel
 * setState('panel', 'ai-chat');
 *
 * // Open step details
 * setState('panel', 'step');
 * setState('step', 'my-step-slug');
 *
 * // Close panel
 * clearState('panel', 'step');
 * ```
 */
export function useUrlState<T extends UrlStateDefinitions>(
  options: UseUrlStateOptions<T>,
): UseUrlStateReturn<T> {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const { definitions, preserveKeys = [], initialValues } = options;

  // Get all managed keys (for URL param names)
  const managedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, def] of Object.entries(definitions)) {
      keys.add(def.urlKey ?? key);
    }
    return keys;
  }, [definitions]);

  // Parse current state from URL
  const state = useMemo(() => {
    const result = {} as ParsedUrlState<T>;

    for (const [key, definition] of Object.entries(definitions)) {
      const urlKey = definition.urlKey ?? key;
      const urlValue = searchParams.get(urlKey);

      // Priority: URL value > initial value > default
      if (urlValue !== null) {
        (result as Record<string, UrlStateValue>)[key] = urlValue;
      } else if (initialValues && key in initialValues) {
        (result as Record<string, UrlStateValue>)[key] = initialValues[key as keyof T] ?? definition.default ?? null;
      } else {
        (result as Record<string, UrlStateValue>)[key] = definition.default ?? null;
      }
    }

    return result;
  }, [searchParams, definitions, initialValues]);

  // Build new URL params, preserving unmanaged keys
  const buildParams = useCallback(
    (updates: Partial<ParsedUrlState<T>>) => {
      const params = new URLSearchParams();

      // Preserve unmanaged keys and explicitly preserved keys
      for (const [key, value] of searchParams.entries()) {
        if (!managedKeys.has(key) || preserveKeys.includes(key)) {
          params.set(key, value);
        }
      }

      // Apply current state
      for (const [key, definition] of Object.entries(definitions)) {
        const urlKey = definition.urlKey ?? key;
        const currentValue = state[key as keyof T];

        // Skip if this key is being updated
        if (key in updates) continue;

        // Only set if value exists and differs from default
        if (currentValue !== null && currentValue !== definition.default) {
          params.set(urlKey, currentValue);
        }
      }

      // Apply updates
      for (const [key, value] of Object.entries(updates)) {
        const definition = definitions[key];
        if (!definition) continue;

        const urlKey = definition.urlKey ?? key;

        if (value === null || value === undefined || value === definition.default) {
          params.delete(urlKey);
        } else {
          params.set(urlKey, value);
        }
      }

      return params;
    },
    [searchParams, definitions, managedKeys, preserveKeys, state],
  );

  // Set a single state value
  const setState = useCallback(
    <K extends keyof T>(key: K, value: UrlStateValue) => {
      const params = buildParams({ [key]: value } as Partial<ParsedUrlState<T>>);
      const queryString = params.toString();

      startTransition(() => {
        router.push(queryString ? `${pathname}?${queryString}` : pathname, {
          scroll: false,
        });
      });
    },
    [buildParams, pathname, router],
  );

  // Set multiple state values at once
  const setStates = useCallback(
    (values: Partial<ParsedUrlState<T>>) => {
      const params = buildParams(values);
      const queryString = params.toString();

      startTransition(() => {
        router.push(queryString ? `${pathname}?${queryString}` : pathname, {
          scroll: false,
        });
      });
    },
    [buildParams, pathname, router],
  );

  // Clear specific keys
  const clearState = useCallback(
    (...keys: Array<keyof T>) => {
      const updates = {} as Partial<ParsedUrlState<T>>;
      for (const key of keys) {
        updates[key] = null as UrlStateValue;
      }
      setStates(updates);
    },
    [setStates],
  );

  // Clear all managed state
  const clearAll = useCallback(() => {
    const updates = {} as Partial<ParsedUrlState<T>>;
    for (const key of Object.keys(definitions)) {
      updates[key as keyof T] = null as UrlStateValue;
    }
    setStates(updates);
  }, [definitions, setStates]);

  return {
    state,
    setState,
    setStates,
    clearState,
    clearAll,
    isPending,
  };
}
