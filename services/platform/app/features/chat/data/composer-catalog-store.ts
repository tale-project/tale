import { isRecord } from '@/lib/utils/type-utils';

import type { ComposerModelOption } from '../types';

/**
 * Last-known composer catalog per organization, persisted for the device
 * (epic sibling of `member-context-cache`). The catalog is an ACTION answer —
 * nothing keeps it warm across a reload — and the chat index decides between
 * its welcome and the provider-setup notice from it, so without this every
 * reload rendered the welcome and then SWAPPED to the notice when the action
 * answered. A reload now starts from the last answer and the per-mount
 * refresh corrects it within a round-trip.
 *
 * Safety model:
 * - Metadata only — model ids/labels, provider slugs, and the credential's
 *   auth METHOD shape (`CredentialAuth`); never key material or previews.
 * - Org-scoped keys; a TTL bounds staleness; malformed or stale records are
 *   removed on read so the cold path stays clean.
 */

export interface ComposerCatalog {
  readonly models: readonly ComposerModelOption[];
  /** Non-chat capability facts (see `listComposerModels`). */
  readonly voice: {
    readonly ttsAvailable: boolean;
    readonly transcriptionAvailable: boolean;
  };
}

// v5: `voice` gained `transcriptionAvailable` (the Firefox dictation
// fallback); the parser requires it, so v4 records retire with the bump.
const STORAGE_KEY_PREFIX = 'tale:composer-catalog:v5:';

/** A stored catalog older than this is stale enough to prefer a fresh load. */
const TTL_MS = 12 * 60 * 60 * 1000;

const isBrowser = typeof window !== 'undefined';

function storageKey(organizationId: string): string {
  return `${STORAGE_KEY_PREFIX}${organizationId}`;
}

function isModelOption(value: unknown): value is ComposerModelOption {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.providerSlug === 'string' &&
    isRecord(value.credential) &&
    typeof value.credential.authMethod === 'string'
  );
}

function parseRecord(raw: string): ComposerCatalog | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { catalog, savedAt } = parsed;
    if (typeof savedAt !== 'number' || savedAt + TTL_MS < Date.now()) {
      return null;
    }
    if (!isRecord(catalog)) return null;
    const { models, voice } = catalog;
    if (!Array.isArray(models) || !models.every(isModelOption)) return null;
    if (
      !isRecord(voice) ||
      typeof voice.ttsAvailable !== 'boolean' ||
      typeof voice.transcriptionAvailable !== 'boolean'
    ) {
      return null;
    }
    return {
      models,
      voice: {
        ttsAvailable: voice.ttsAvailable,
        transcriptionAvailable: voice.transcriptionAvailable,
      },
    };
  } catch (error) {
    console.warn('Failed to parse the stored composer catalog:', error);
    return null;
  }
}

/**
 * The last catalog this org answered with on this device, or `null` when
 * absent, stale, or malformed (bad records are removed).
 */
export function readStoredComposerCatalog(
  organizationId: string,
): ComposerCatalog | null {
  if (!isBrowser) return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(organizationId));
  } catch (error) {
    console.warn('Failed to read the stored composer catalog:', error);
    return null;
  }
  if (!raw) return null;
  const catalog = parseRecord(raw);
  if (!catalog) clearStoredComposerCatalog(organizationId);
  return catalog;
}

/** Persist the org's freshly answered catalog. */
export function storeComposerCatalog(
  organizationId: string,
  catalog: ComposerCatalog,
): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(
      storageKey(organizationId),
      JSON.stringify({ catalog, savedAt: Date.now() }),
    );
  } catch (error) {
    // Quota / security errors — the instant first paint is lost for the next
    // reload only; the per-mount refresh still renders this session correctly.
    console.warn('Failed to persist the composer catalog:', error);
  }
}

export function clearStoredComposerCatalog(organizationId: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(storageKey(organizationId));
  } catch (error) {
    console.warn('Failed to clear the stored composer catalog:', error);
  }
}
