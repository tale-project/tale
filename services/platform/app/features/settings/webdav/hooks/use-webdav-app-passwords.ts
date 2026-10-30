import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { readStateOf } from '@/app/lib/backend/read-state';

/**
 * The app-passwords, with how the read stands (`readStateOf`). `rows` stays
 * `undefined` until the read answers so the UI can tell its skeleton from
 * the empty state: coercing to `[]` would flash "No app-passwords yet." on
 * first paint, and on a read that failed. `error` is the read's settled
 * failure, which the table shows with `retry` instead of a skeleton that
 * never ends (#4652); react-query clears it while it retries a read that
 * never answered.
 */
export function useWebdavAppPasswords(organizationId: string) {
  const query = useBackendQuery(
    'webdav/app_password_queries:listAppPasswords',
    { organizationId },
  );
  const { refetch } = query;

  return {
    rows: query.data,
    error: query.error,
    ...readStateOf(query),
    retry: () => void refetch(),
  };
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
  ReturnType<typeof useWebdavAppPasswords>['rows']
>[number];
