import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useWebdavAppPasswords(organizationId: string) {
  const rows = useQuery(api.webdav.app_password_queries.listAppPasswords, {
    organizationId,
  });
  return rows ?? [];
}

export function useCreateWebdavAppPassword() {
  return useMutation(api.webdav.app_password_mutations.createAppPassword);
}

export function useRevokeWebdavAppPassword() {
  return useMutation(api.webdav.app_password_mutations.revokeAppPassword);
}

export type WebdavAppPasswordRow = ReturnType<
  typeof useWebdavAppPasswords
>[number];

export type WebdavAppPasswordId = Id<'webdavAppPasswords'>;
