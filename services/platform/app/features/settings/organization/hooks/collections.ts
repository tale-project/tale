import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Member } from '@/lib/collections/entities/members';

import { createMembersCollection } from '@/lib/collections/entities/members';
import { useCollection } from '@/lib/collections/use-collection';

export function useMemberCollection(organizationId: string) {
  return useCollection('members', createMembersCollection, organizationId);
}

export function useMembers(collection: Collection<Member, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ member: collection }).select(({ member }) => member),
  );

  return {
    members: data,
    isLoading,
  };
}

export type { Member };
