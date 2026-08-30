import { useBackendReachable } from '@/app/lib/backend/connection-state';

/**
 * The connectivity shape the offline overlay consumes. Convex's WebSocket is
 * gone, so `isWebSocketConnected` now means "the backend is answering" — the
 * hint stream's own state (see `lib/backend/connection-state.ts`).
 */
export function useBackendConnectionState(): { isWebSocketConnected: boolean } {
  return { isWebSocketConnected: useBackendReachable() };
}
