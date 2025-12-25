import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useClearActiveRunId() {
  return useMutation(api.threads.clearActiveRunId).withOptimisticUpdate(
    (localStore, args) => {
      const currentThreads = localStore.getQuery(api.threads.listThreads, {});
      if (currentThreads !== undefined) {
        localStore.setQuery(
          api.threads.listThreads,
          {},
          currentThreads.map((thread) =>
            thread._id === args.threadId
              ? { ...thread, activeRunId: undefined }
              : thread
          )
        );
      }
    }
  );
}
