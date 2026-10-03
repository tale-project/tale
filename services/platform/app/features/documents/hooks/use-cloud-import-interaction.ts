import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * An import keeps running when its picker closes. Capture its interaction
 * before the first await: only that still-open interaction may close the
 * picker or hand it to Reconnect. A later result still reports in a toast.
 * A token, rather than a mounted flag, also separates close/reopen when a
 * controlled caller keeps the picker component mounted. Changing the
 * organization or destination also starts a different interaction.
 */
export function useCloudImportInteraction(
  open: boolean | undefined,
  organizationId: string,
  destinationFolderId: string | undefined,
) {
  const active = useRef<symbol | undefined>(undefined);
  useLayoutEffect(() => {
    active.current = open ? Symbol() : undefined;
    return () => {
      active.current = undefined;
    };
  }, [open, organizationId, destinationFolderId]);

  return useCallback(() => {
    const interaction = active.current;
    return () => interaction !== undefined && active.current === interaction;
  }, []);
}
