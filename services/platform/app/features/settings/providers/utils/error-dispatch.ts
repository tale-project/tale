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

/**
 * Surface an access-revoked / session-expired toast when the server rejects
 * with one of the org-identity error codes thrown by
 * `requireOrgMembershipById`. Triggered when the user lost membership of the
 * org their URL still points at (admin removed them, org deleted, session
 * expired). Returns `true` if the error was handled.
 *
 * The message is intentionally distinct from a generic operation failure so
 * the user can recover (refresh, switch org, sign in again) rather than
 * retrying the same broken request.
 *
 * `tAccessDenied` must be a `t` scoped to the top-level `accessDenied`
 * namespace (i.e. `useT('accessDenied')`), since the strings live there
 * rather than under the providers feature tree.
 */
export function dispatchOrgAccessError(
  err: unknown,
  tAccessDenied: (key: string) => string,
): boolean {
  const data = readConvexErrorData(err);
  const code = data?.code;
  // Static keys per branch so the messages-usage scanner can see them.
  if (code === 'UNAUTHENTICATED') {
    toast({
      title: tAccessDenied('title'),
      description: tAccessDenied('unauthenticated'),
      variant: 'destructive',
    });
    return true;
  }
  if (code === 'ORG_NOT_FOUND') {
    toast({
      title: tAccessDenied('title'),
      description: tAccessDenied('workspaceNotFound'),
      variant: 'destructive',
    });
    return true;
  }
  if (code === 'ORG_FORBIDDEN') {
    toast({
      title: tAccessDenied('title'),
      description: tAccessDenied('noMembership'),
      variant: 'destructive',
    });
    return true;
  }
  return false;
}

/**
 * Surface a "reload to see latest" toast when the server rejects with
 * `PROVIDER_VERSION_CONFLICT`. Triggered when another tab/operator changed
 * the provider config between our load and our save (or deleted it).
 * Returns `true` if the error was handled.
 */
export function dispatchVersionConflict(
  err: unknown,
  t: (key: string) => string,
): boolean {
  const data = readConvexErrorData(err);
  if (data?.code !== 'PROVIDER_VERSION_CONFLICT') return false;
  toast({
    title: t('providers.versionConflictTitle'),
    description: t('providers.versionConflictDescription'),
    variant: 'destructive',
  });
  return true;
}
