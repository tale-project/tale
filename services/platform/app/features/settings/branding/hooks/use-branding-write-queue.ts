import { useCallback, useRef } from 'react';

export type BrandingWriteRunner = <Result>(
  write: () => Promise<Result>,
) => Promise<Result>;

export const runBrandingWrite: BrandingWriteRunner = (write) => write();

export function useBrandingWriteQueue(): BrandingWriteRunner {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(<Result>(write: () => Promise<Result>) => {
    const result = tail.current.then(write);
    tail.current = result.catch(() => undefined);
    return result;
  }, []);
}
