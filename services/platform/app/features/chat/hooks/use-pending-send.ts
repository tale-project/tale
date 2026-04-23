import { useSyncExternalStore } from 'react';

/**
 * Per-thread optimistic "send in flight" flag, set the moment a user clicks
 * send and cleared when the server confirms via `isThreadGenerating` or the
 * send promise rejects. Exists because the round-trip through the `'use node'`
 * `chatWithAgent` action adds ~200–550 ms before the spinner would otherwise
 * appear, which feels laggy.
 *
 * Drives VISUAL state only (spinner, composer disable). The Stop button stays
 * on the real server signal — see chat-interface.tsx.
 */

const SAFETY_TIMEOUT_MS = 8000;

const pendingByThread = new Map<
  string,
  { timer: ReturnType<typeof setTimeout> }
>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markSendPending(threadId: string): void {
  const existing = pendingByThread.get(threadId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingByThread.delete(threadId);
    emit();
  }, SAFETY_TIMEOUT_MS);
  pendingByThread.set(threadId, { timer });
  emit();
}

export function clearSendPending(threadId: string): void {
  const existing = pendingByThread.get(threadId);
  if (!existing) return;
  clearTimeout(existing.timer);
  pendingByThread.delete(threadId);
  emit();
}

export function useIsSendPending(threadId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (threadId ? pendingByThread.has(threadId) : false),
    () => false,
  );
}
