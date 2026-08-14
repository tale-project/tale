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
      id: 'deepseek-v4-flash',
      label: 'deepseek-v4-flash',
      providerSlug: 'deepseek',
      credential: { authMethod: 'api-key' },
    },
  ],
  voice: { ttsAvailable: false, transcriptionAvailable: false },
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
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    });
    expect(readStoredComposerCatalog('org-empty')).toEqual({
      models: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
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
      window.localStorage.getItem('tale:composer-catalog:v5:org-stale'),
    ).toBeNull();
  });

  it('rejects malformed and wrong-shaped records', () => {
    window.localStorage.setItem(
      'tale:composer-catalog:v5:org-bad',
      'not json at all',
    );
    expect(readStoredComposerCatalog('org-bad')).toBeNull();

    window.localStorage.setItem(
      'tale:composer-catalog:v5:org-shape',
      JSON.stringify({
        catalog: {
          models: [{ id: 42 }],
          voice: { ttsAvailable: false, transcriptionAvailable: false },
        },
        savedAt: Date.now(),
      }),
    );
    expect(readStoredComposerCatalog('org-shape')).toBeNull();
  });

  it('never reads a v3 record — the externalAgents era retired with its key', () => {
    // A record the pre-boundary build wrote: well-formed for ITS schema and
    // fresh, but under the old key. The key bump retires it wholesale — the
    // read never even looks at it.
    window.localStorage.setItem(
      'tale:composer-catalog:v3:org-legacy',
      JSON.stringify({
        catalog: {
          models: CATALOG.models,
          externalAgents: [{ harness: 'claude-code', label: 'Claude Code' }],
          voice: { ttsAvailable: false },
        },
        savedAt: Date.now(),
      }),
    );

    expect(readStoredComposerCatalog('org-legacy')).toBeNull();
  });

  it('never reads a v4 record — voice lacked transcriptionAvailable before the bump', () => {
    // Well-formed for the v4 schema and fresh, but under the retired key:
    // the parser now requires `voice.transcriptionAvailable`, so v4 records
    // retire wholesale with the key bump instead of failing parse one by one.
    window.localStorage.setItem(
      'tale:composer-catalog:v4:org-legacy-v4',
      JSON.stringify({
        catalog: { models: CATALOG.models, voice: { ttsAvailable: false } },
        savedAt: Date.now(),
      }),
    );

    expect(readStoredComposerCatalog('org-legacy-v4')).toBeNull();
  });

  it('clears a stored record on demand', () => {
    storeComposerCatalog('org-clear', CATALOG);
    clearStoredComposerCatalog('org-clear');
    expect(readStoredComposerCatalog('org-clear')).toBeNull();
  });
});
