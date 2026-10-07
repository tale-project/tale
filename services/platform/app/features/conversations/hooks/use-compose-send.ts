import { useSyncExternalStore } from 'react';

/**
 * Compose sends in flight, per draft (user + org), kept outside the pane that
 * started them. Navigation can unmount Compose while it sends, and reopening
 * it restores the same persisted draft. That pane must stay frozen until the
 * send settles, and a success that lands after the sending pane went away
 * still has to clear the draft it shows: otherwise the old request would go
 * out twice or delete a revision made after it.
 */
interface ComposeSendState {
  /** A send of this draft is in flight. */
  pending: boolean;
  /** How many sends of this draft went out; each one cleared it. */
  sent: number;
}

const IDLE: ComposeSendState = { pending: false, sent: 0 };
const sends = new Map<string, ComposeSendState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(draftKey: string, next: ComposeSendState) {
  sends.set(draftKey, next);
  for (const listener of listeners) listener();
}

export function useComposeSend(draftKey: string): ComposeSendState {
  return useSyncExternalStore(subscribe, () => sends.get(draftKey) ?? IDLE);
}

/** Claim the draft for one send; false while another send of it is in flight. */
export function beginComposeSend(draftKey: string): boolean {
  const current = sends.get(draftKey) ?? IDLE;
  if (current.pending) return false;
  publish(draftKey, { ...current, pending: true });
  return true;
}

/** Release the draft; `sent` when the email went out and cleared it. */
export function settleComposeSend(draftKey: string, sent: boolean) {
  const current = sends.get(draftKey) ?? IDLE;
  publish(draftKey, {
    pending: false,
    sent: sent ? current.sent + 1 : current.sent,
  });
}
