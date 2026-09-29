import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

export function useWebdavAppPasswords(organizationId: string) {
  // Return `undefined` while loading so the UI can distinguish skeleton vs
  // empty-state. Coercing to `[]` here would collapse both into the empty
  // path and flash "No app-passwords yet." on first paint.
  const { data } = useBackendQuery(
    'webdav/app_password_queries:listAppPasswords',
    { organizationId },
  );
  return data;
}

// The settings page toasts a failed create or revoke itself (a spent limit
// or a gone password by name); the default toast would report it again.
export function useCreateWebdavAppPassword() {
  return useBackendMutation('webdav/app_password_mutations:createAppPassword', {
    errorToast: false,
  }).mutateAsync;
}

export function useRevokeWebdavAppPassword() {
  return useBackendMutation('webdav/app_password_mutations:revokeAppPassword', {
    errorToast: false,
  }).mutateAsync;
}

export type WebdavAppPasswordRow = NonNullable<
  ReturnType<typeof useWebdavAppPasswords>
>[number];
