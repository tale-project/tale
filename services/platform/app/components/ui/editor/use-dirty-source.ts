'use client';

import { createContext, useContext, useEffect, useId } from 'react';

interface DirtySourceRegistry {
  register: (id: string, dirty: boolean) => void;
  /** Drop a source entirely (on unmount) so the registry stays bounded. */
  unregister: (id: string) => void;
}

export const DirtySourceContext = createContext<DirtySourceRegistry | null>(
  null,
);

/**
 * Registers the caller as a dirty-state source with the nearest
 * `DirtyBlockerProvider`. The provider aggregates every source so the
 * navigation blocker fires exactly once per page transition even when
 * multiple editors are dirty.
 *
 * Called internally by `useJsonConfigEditor` and `useFormEditor`; consumers
 * rarely need to invoke it directly.
 */
export function useRegisterDirtySource(isDirty: boolean): void {
  const ctx = useContext(DirtySourceContext);
  const id = useId();

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
    ctx.register(id, isDirty);
  }, [ctx, id, isDirty]);

  useEffect(
    () => () => {
      ctx?.unregister(id);
    },
    [ctx, id],
  );
}
