// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearStoredComposerCatalog,
  readStoredComposerCatalog,
  storeComposerCatalog,
  type ComposerCatalog,
} from './composer-catalog-store';

const CATALOG: ComposerCatalog = {
  models: [
    {
      id: 'deepseek-chat',
      label: 'deepseek-chat',
      providerSlug: 'deepseek',
      credential: { authMethod: 'api-key' },
    },
  ],
  externalAgents: [{ harness: 'claude-code', label: 'Claude Code' }],
  voice: { ttsAvailable: false },
};

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('composer catalog store', () => {
  it('round-trips an org catalog', () => {
    storeComposerCatalog('org-store', CATALOG);
    expect(readStoredComposerCatalog('org-store')).toEqual(CATALOG);
    // Org-scoped: another org reads nothing.
    expect(readStoredComposerCatalog('org-other')).toBeNull();
  });

  it('round-trips the empty catalog — "no provider yet" is an answer too', () => {
    storeComposerCatalog('org-empty', {
      models: [],
      externalAgents: [],
      voice: { ttsAvailable: false },
    });
    expect(readStoredComposerCatalog('org-empty')).toEqual({
      models: [],
      externalAgents: [],
      voice: { ttsAvailable: false },
    });
  });

  it('expires a stale record instead of serving ancient state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    storeComposerCatalog('org-stale', CATALOG);
    vi.setSystemTime(new Date('2026-07-02T00:00:01Z'));

    expect(readStoredComposerCatalog('org-stale')).toBeNull();
    // The stale record was removed, not left to be re-parsed every read.
    expect(
      window.localStorage.getItem('tale:composer-catalog:v1:org-stale'),
    ).toBeNull();
  });

  it('rejects malformed and wrong-shaped records', () => {
    window.localStorage.setItem(
      'tale:composer-catalog:v1:org-bad',
      'not json at all',
    );
    expect(readStoredComposerCatalog('org-bad')).toBeNull();

    window.localStorage.setItem(
      'tale:composer-catalog:v1:org-shape',
      JSON.stringify({
        catalog: { models: [{ id: 42 }], externalAgents: [] },
        savedAt: Date.now(),
      }),
    );
    expect(readStoredComposerCatalog('org-shape')).toBeNull();
  });

  it('clears a stored record on demand', () => {
    storeComposerCatalog('org-clear', CATALOG);
    clearStoredComposerCatalog('org-clear');
    expect(readStoredComposerCatalog('org-clear')).toBeNull();
  });
});
