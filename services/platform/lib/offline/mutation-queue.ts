import { db } from './db';
import type { QueuedMutation } from './types';

export async function addToQueue(
  mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'retryCount' | 'status'>
): Promise<string> {
  const id = crypto.randomUUID();
  const queuedMutation: QueuedMutation = {
    ...mutation,
    id,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending',
  };

  await db.mutationQueue.add(queuedMutation);
  await registerBackgroundSync();

  return id;
}

export async function getPendingMutations(): Promise<QueuedMutation[]> {
  return db.mutationQueue
    .where('status')
    .equals('pending')
    .sortBy('timestamp');
}

export async function getFailedMutations(): Promise<QueuedMutation[]> {
  return db.mutationQueue.where('status').equals('failed').toArray();
}

export async function getMutationById(
  id: string
): Promise<QueuedMutation | undefined> {
  return db.mutationQueue.get(id);
}

export async function updateMutationStatus(
  id: string,
  status: QueuedMutation['status'],
  error?: string
): Promise<void> {
  const updates: Partial<QueuedMutation> = { status };
  if (error) updates.error = error;

  await db.mutationQueue.update(id, updates);
}

export async function incrementRetryCount(id: string): Promise<number> {
  const mutation = await db.mutationQueue.get(id);
  if (!mutation) return 0;

  const newCount = mutation.retryCount + 1;
  await db.mutationQueue.update(id, { retryCount: newCount });

  return newCount;
}

export async function removeMutation(id: string): Promise<void> {
  await db.mutationQueue.delete(id);
}

export async function clearCompletedMutations(): Promise<number> {
  const pendingIds = await db.mutationQueue
    .where('status')
    .notEqual('pending')
    .primaryKeys();

  await db.mutationQueue.bulkDelete(
    pendingIds.filter(async (id) => {
      const m = await db.mutationQueue.get(id);
      return m?.status !== 'processing';
    })
  );

  return pendingIds.length;
}

export async function clearAllMutations(): Promise<void> {
  await db.mutationQueue.clear();
}

export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  failed: number;
  total: number;
}> {
  const [pending, processing, failed] = await Promise.all([
    db.mutationQueue.where('status').equals('pending').count(),
    db.mutationQueue.where('status').equals('processing').count(),
    db.mutationQueue.where('status').equals('failed').count(),
  ]);

  return {
    pending,
    processing,
    failed,
    total: pending + processing + failed,
  };
}

export async function retryFailedMutation(id: string): Promise<void> {
  await db.mutationQueue.update(id, {
    status: 'pending',
    error: undefined,
  });
  await registerBackgroundSync();
}

export async function retryAllFailedMutations(): Promise<number> {
  const failed = await getFailedMutations();
  await Promise.all(failed.map((m) => retryFailedMutation(m.id)));
  return failed.length;
}

async function registerBackgroundSync(): Promise<void> {
  if (
    'serviceWorker' in navigator &&
    'sync' in (window.ServiceWorkerRegistration?.prototype ?? {})
  ) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('mutation-sync');
    } catch {
      // Background sync not supported or failed
    }
  }
}

export function subscribeToQueueChanges(
  callback: (stats: { pending: number; failed: number }) => void
): () => void {
  const updateStats = async () => {
    const stats = await getQueueStats();
    callback({ pending: stats.pending, failed: stats.failed });
  };

  const handleChange = () => {
    updateStats();
  };

  db.mutationQueue.hook('creating', handleChange);
  db.mutationQueue.hook('updating', handleChange);
  db.mutationQueue.hook('deleting', handleChange);

  updateStats();

  return () => {
    db.mutationQueue.hook('creating').unsubscribe(handleChange);
    db.mutationQueue.hook('updating').unsubscribe(handleChange);
    db.mutationQueue.hook('deleting').unsubscribe(handleChange);
  };
}
