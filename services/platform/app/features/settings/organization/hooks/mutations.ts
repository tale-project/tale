import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Member } from '@/lib/collections/entities/members';

export function useRemoveMember(collection: Collection<Member, string>) {
  return useCallback(
    async (args: { memberId: string }) => {
      const tx = collection.delete(args.memberId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateMemberRole(collection: Collection<Member, string>) {
  return useCallback(
    async (args: { memberId: string; role: string }) => {
      const tx = collection.update(args.memberId, (draft) => {
        draft.role = args.role;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateMemberDisplayName(
  collection: Collection<Member, string>,
) {
  return useCallback(
    async (args: { memberId: string; displayName: string }) => {
      const tx = collection.update(args.memberId, (draft) => {
        draft.displayName = args.displayName;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
