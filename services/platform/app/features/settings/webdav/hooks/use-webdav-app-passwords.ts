import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';

export function useWebdavAppPasswords(organizationId: string) {
  // Return `undefined` while loading so the UI can distinguish skeleton vs
  // empty-state. Coercing to `[]` here would collapse both into the empty
  // path and flash "No app-passwords yet." on first paint.
  const { data } = useConvexQuery(
    'webdav/app_password_queries:listAppPasswords',
    { organizationId },
  );
  return data;
}

export function useCreateWebdavAppPassword() {
  return useConvexMutation('webdav/app_password_mutations:createAppPassword')
    .mutateAsync;
}

export function useRevokeWebdavAppPassword() {
  return useConvexMutation('webdav/app_password_mutations:revokeAppPassword')
    .mutateAsync;
}

export type WebdavAppPasswordRow = NonNullable<
  ReturnType<typeof useWebdavAppPasswords>
>[number];

export type WebdavAppPasswordId = string;
