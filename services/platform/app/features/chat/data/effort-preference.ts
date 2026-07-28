import { isReasoningEffort, type ReasoningEffort } from '@/lib/chat/effort';

/**
 * The user's last reasoning-effort pick per organization, persisted for the
 * device — the SEED for a new conversation's effort control (sibling of
 * `composer-catalog-store`). An existing thread reads its pick from the
 * thread row (`ChatThreadSummary.reasoningEffort`); this store only decides
 * what a fresh composer starts on, so a lost or unreadable record costs one
 * re-pick and nothing else. Every storage failure is tolerated — logged,
 * never thrown — because localStorage may be full, disabled, or absent (SSR).
 */

const STORAGE_KEY_PREFIX = 'tale:chat-effort:v1:';

const isBrowser = typeof window !== 'undefined';

function storageKey(organizationId: string): string {
  return `${STORAGE_KEY_PREFIX}${organizationId}`;
}

/**
 * The org's remembered effort pick on this device, or `undefined` when none
 * was saved, the record is not a known level, or storage is unreadable.
 */
export function readEffortPreference(
  organizationId: string,
): ReasoningEffort | undefined {
  if (!isBrowser) return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(organizationId));
    return isReasoningEffort(raw) ? raw : undefined;
  } catch (error) {
    console.warn('Failed to read the stored effort preference:', error);
    return undefined;
  }
}

/** Remember the pick (`null` forgets it — the default level). */
export function writeEffortPreference(
  organizationId: string,
  effort: ReasoningEffort | null,
): void {
  if (!isBrowser) return;
  try {
    if (effort === null) {
      window.localStorage.removeItem(storageKey(organizationId));
      return;
    }
    window.localStorage.setItem(storageKey(organizationId), effort);
  } catch (error) {
    console.warn('Failed to persist the effort preference:', error);
  }
}
