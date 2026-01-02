import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCreateThread() {
  return useMutation(api.threads.createChatThread).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.threads.listThreads, {});

      if (currentThreads !== undefined) {
        // Create optimistic thread entry at the top of the list
        // Uses a temporary ID that will be replaced when the server responds
        const optimisticThread = {
          _id: `optimistic-${Date.now()}`,
          _creationTime: Date.now(),
          title: args.title,
          status: 'active' as const,
          userId: undefined,
        };

        localStore.setQuery(api.threads.listThreads, {}, [
          optimisticThread,
          ...currentThreads,
        ]);
      }
    },
  );
}
