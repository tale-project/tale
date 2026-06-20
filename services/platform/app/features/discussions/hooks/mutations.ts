import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/** Open a new project discussion (optionally @mention an agent in the body). */
export function useCreateDiscussion() {
  return useConvexMutation(api.discussions.mutations.createDiscussion);
}

/** Post a reply into a discussion. */
export function usePostReply() {
  return useConvexMutation(api.discussions.mutations.postReply);
}

/** Resolve / reopen / lock a discussion. */
export function useSetDiscussionStatus() {
  return useConvexMutation(api.discussions.mutations.setDiscussionStatus);
}

/** Spawn a task from a discussion (bidirectional backlink). */
export function useCreateTaskFromDiscussion() {
  return useConvexMutation(api.discussions.mutations.createTaskFromDiscussion);
}
