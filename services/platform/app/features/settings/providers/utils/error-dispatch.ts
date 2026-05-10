import { toast } from '@/app/hooks/use-toast';

/**
 * Read structured `data` off a Convex action error without
 * `instanceof ConvexError`. Vite HMR / chunk splitting can produce multiple
 * copies of the `ConvexError` class — the prototype-chain check then returns
 * false even though the error IS a `ConvexError`. The UI only needs the
 * structural shape (`{ data: { code, ... } }`), so check that directly.
 */
export function readConvexErrorData(
  err: unknown,
): Record<string, unknown> | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- data is a runtime-checked object; downstream reads narrow per-field
  return data as Record<string, unknown>;
}

/**
 * Surface a permission-denied toast when the server rejects with the
 * developerSettings gate's discriminator. Returns `true` if the error was
 * handled (caller should NOT also toast a generic failure).
 */
export function dispatchForbiddenDeveloperSettings(
  err: unknown,
  t: (key: string) => string,
): boolean {
  const data = readConvexErrorData(err);
  if (data?.code !== 'FORBIDDEN_DEVELOPER_SETTINGS') return false;
  toast({
    title: t('providers.forbiddenDeveloperSettings'),
    variant: 'destructive',
  });
  return true;
}
