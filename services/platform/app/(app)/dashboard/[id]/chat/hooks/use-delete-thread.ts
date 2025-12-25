import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteThread() {
  return useMutation(api.threads.deleteChatThread).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.threads.listThreads, {});

      if (currentThreads !== undefined) {
        const updatedThreads = currentThreads.filter(
          (thread) => thread._id !== args.threadId
        );
        localStore.setQuery(api.threads.listThreads, {}, updatedThreads);
      }
    }
  );
}
