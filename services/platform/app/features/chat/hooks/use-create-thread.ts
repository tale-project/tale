import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useCreateThread() {
  return useMutation(
    api.threads.mutations.createChatThread,
  ).withOptimisticUpdate((localStore, args) => {
    const currentThreads = localStore.getQuery(
      api.threads.queries.listThreads,
      {},
    );

    if (currentThreads !== undefined) {
      const optimisticThread = {
        _id: `optimistic-${Date.now()}`,
        _creationTime: Date.now(),
        title: args.title,
        status: 'active' as const,
        userId: undefined,
      };

      localStore.setQuery(api.threads.queries.listThreads, {}, [
        optimisticThread,
        ...currentThreads,
      ]);
    }
  });
}
