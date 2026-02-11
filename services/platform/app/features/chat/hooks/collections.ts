import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Thread } from '@/lib/collections/entities/threads';

import { createThreadsCollection } from '@/lib/collections/entities/threads';
import { useCollection } from '@/lib/collections/use-collection';

export function useThreadCollection() {
  return useCollection('threads', createThreadsCollection, 'user-threads');
}

export function useThreads(collection: Collection<Thread, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ thread: collection }).select(({ thread }) => thread),
  );

  return {
    threads: data,
    isLoading,
  };
}
