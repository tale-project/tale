import { createThreadsCollection } from '@/lib/collections/entities/threads';
import { useCollection } from '@/lib/collections/use-collection';

export function useThreadCollection() {
  return useCollection('threads', createThreadsCollection, 'user-threads');
}
