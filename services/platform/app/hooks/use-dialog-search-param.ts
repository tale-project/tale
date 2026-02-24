'use client';

import { useCallback, useMemo } from 'react';

import { useUrlState, type UrlStateDefinitions } from './use-url-state';

interface UseDialogSearchParamOptions {
  paramValue: string;
  paramKey?: string;
}

interface UseDialogSearchParamReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  onOpenChange: (open: boolean) => void;
}

export function useDialogSearchParam({
  paramValue,
  paramKey = 'dialog',
}: UseDialogSearchParamOptions): UseDialogSearchParamReturn {
  const definitions = useMemo(
    (): UrlStateDefinitions => ({
      [paramKey]: { default: null },
    }),
    [paramKey],
  );

  const { state, setState, clearState } = useUrlState({ definitions });

  const isOpen = state[paramKey] === paramValue;

  const open = useCallback(() => {
    setState(paramKey, paramValue);
  }, [setState, paramKey, paramValue]);

  const close = useCallback(() => {
    clearState(paramKey);
  }, [clearState, paramKey]);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        open();
      } else {
        close();
      }
    },
    [open, close],
  );

  return { isOpen, open, close, onOpenChange };
}
