import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateThread() {
  return useMutation(api.threads.mutations.updateChatThread).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.threads.queries.listThreads, {});

      if (currentThreads !== undefined && args.title) {
        const updatedThreads = currentThreads.map((thread) =>
          thread._id === args.threadId
            ? { ...thread, title: args.title }
            : thread,
        );
        localStore.setQuery(api.threads.queries.listThreads, {}, updatedThreads);
      }
    },
  );
}
