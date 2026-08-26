// The real routing rule, not a restatement of it.
//
// `rag_dispatch.test.ts` mocks this module so the pools are observable, which
// means it cannot catch a mistake in `ragPoolFor` itself. This suite imports
// the real thing.

import { describe, expect, it } from 'vitest';

const { ragPoolFor, ragInteractivePool, ragBackgroundPool } =
  await import('./rag_pools');

describe('ragPoolFor', () => {
  it('routes a member upload to the interactive pool', () => {
    expect(ragPoolFor('user')).toBe(ragInteractivePool);
  });

  it('routes every other provenance to the background pool', () => {
    // An open string, so this is an allow-list: connector slugs, agent output,
    // transcripts and anything added later are all background.
    for (const source of [
      'agent',
      'video_link',
      'google_drive',
      'onedrive',
      'sharepoint',
      'confluence',
      'webdav',
      'imap_smtp',
      'something_added_next_year',
    ]) {
      expect(ragPoolFor(source)).toBe(ragBackgroundPool);
    }
  });

  it('routes an unstamped row to the background pool', () => {
    // The fail-safe direction. A background job mistaken for interactive can
    // starve a member's upload, which is the defect the split exists to fix;
    // the reverse only makes an import wait.
    expect(ragPoolFor(undefined)).toBe(ragBackgroundPool);
  });

  it('keeps the two pools distinct', () => {
    expect(ragInteractivePool).not.toBe(ragBackgroundPool);
  });
});
