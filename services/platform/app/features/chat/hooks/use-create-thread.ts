import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCreateThread() {
  return useMutation(api.mutations.threads.createChatThread).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.queries.threads.listThreads, {});

      if (currentThreads !== undefined) {
        const optimisticThread = {
          _id: `optimistic-${Date.now()}`,
          _creationTime: Date.now(),
          title: args.title,
          status: 'active' as const,
          userId: undefined,
        };

        localStore.setQuery(api.queries.threads.listThreads, {}, [
          optimisticThread,
          ...currentThreads,
        ]);
      }
    },
  );
}
