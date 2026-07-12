'use client';

import { createContext, useContext, useEffect, useId, useRef } from 'react';

/** One registered dirty-state source, as the blocker provider sees it. */
export interface DirtySourceEntry {
  dirty: boolean;
  /**
   * Route-path prefix inside which this source's state survives navigation
   * (e.g. the agent editor's base path — its config lives in a provider
   * ABOVE the tab routes, so switching tabs loses nothing). Navigations that
   * stay within the scope are never blocked by this source; leaving it is.
   * Omit for sources whose edits die with any navigation (the default).
   */
  scopePath?: string;
  /**
   * Persist this source's pending edits. When EVERY dirty source provides
   * one, the navigation dialog offers "Save & Leave". Register it only while
   * a save can actually succeed (e.g. the draft is valid).
   */
  save?: () => Promise<void>;
}

interface DirtySourceRegistry {
  register: (id: string, entry: DirtySourceEntry) => void;
  /** Drop a source entirely (on unmount) so the registry stays bounded. */
  unregister: (id: string) => void;
}

export const DirtySourceContext = createContext<DirtySourceRegistry | null>(
  null,
);

export interface DirtySourceOptions {
  /** See {@link DirtySourceEntry.scopePath}. */
  scopePath?: string;
  /** See {@link DirtySourceEntry.save}. */
  save?: () => Promise<void>;
}

/**
 * Registers the caller as a dirty-state source with the nearest
 * `DirtyBlockerProvider`. The provider aggregates every source so the
 * navigation blocker fires exactly once per page transition even when
 * multiple editors are dirty.
 *
 * Called internally by `useJsonConfigEditor` and `useFormEditor`; consumers
 * rarely need to invoke it directly.
 */
export function useRegisterDirtySource(
  isDirty: boolean,
  options?: DirtySourceOptions,
): void {
  const ctx = useContext(DirtySourceContext);
  const id = useId();

  // The provider invokes `save` at dialog-click time; route it through a ref
  // so re-renders that only change the callback's identity (fresh closures
  // every render in most editors) don't churn the registry, while the click
  // still reaches the LATEST closure.
  const saveRef = useRef(options?.save);
  saveRef.current = options?.save;
  const hasSave = options?.save !== undefined;
  const scopePath = options?.scopePath;

  useEffect(() => {
    if (!ctx) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          '[useRegisterDirtySource] No DirtyBlockerProvider in scope. ' +
            'Navigation will not be blocked on unsaved changes.',
        );
      }
      return;
    }
    ctx.register(id, {
      dirty: isDirty,
      ...(scopePath !== undefined && { scopePath }),
      ...(hasSave && {
        save: async () => {
          await saveRef.current?.();
        },
      }),
    });
  }, [ctx, id, isDirty, scopePath, hasSave]);

  useEffect(
    () => () => {
      ctx?.unregister(id);
    },
    [ctx, id],
  );
}
