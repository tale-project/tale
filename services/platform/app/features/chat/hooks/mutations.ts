import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Thread } from '@/lib/collections/entities/threads';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateThread() {
  return useConvexMutation(api.threads.mutations.createChatThread);
}

export function useDeleteThread(collection: Collection<Thread, string>) {
  return useCallback(
    async (args: { threadId: string }) => {
      const tx = collection.delete(args.threadId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateThread(collection: Collection<Thread, string>) {
  return useCallback(
    async (args: { threadId: string; title: string }) => {
      const tx = collection.update(args.threadId, (draft) => {
        draft.title = args.title;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}
