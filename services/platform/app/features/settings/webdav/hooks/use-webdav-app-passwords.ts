import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useWebdavAppPasswords(organizationId: string) {
  // Return `undefined` while loading so the UI can distinguish skeleton vs
  // empty-state. Coercing to `[]` here would collapse both into the empty
  // path and flash "No app-passwords yet." on first paint.
  return useQuery(api.webdav.app_password_queries.listAppPasswords, {
    organizationId,
  });
}

export function useCreateWebdavAppPassword() {
  return useMutation(api.webdav.app_password_mutations.createAppPassword);
}

export function useRevokeWebdavAppPassword() {
  return useMutation(api.webdav.app_password_mutations.revokeAppPassword);
}

export type WebdavAppPasswordRow = NonNullable<
  ReturnType<typeof useWebdavAppPasswords>
>[number];

export type WebdavAppPasswordId = Id<'webdavAppPasswords'>;
