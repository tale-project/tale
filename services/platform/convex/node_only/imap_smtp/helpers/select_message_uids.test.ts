import { describe, expect, it } from 'vitest';

import {
  shouldUseRecentSentFetch,
  uidsFromSearch,
} from './select_message_uids';

describe('shouldUseRecentSentFetch', () => {
  it('uses fallback when Sent SEARCH returns an empty array', () => {
    expect(
      shouldUseRecentSentFetch({
        searchUids: [],
        searchThrew: false,
        mailboxExists: 12,
        sentFolder: true,
        maxResults: 25,
      }),
    ).toBe(true);
  });

  it('does not use fallback for INBOX when SEARCH is empty', () => {
    expect(
      shouldUseRecentSentFetch({
        searchUids: [],
        searchThrew: false,
        mailboxExists: 12,
        sentFolder: false,
        maxResults: 25,
      }),
    ).toBe(false);
  });

  it('keeps SEARCH hits when present', () => {
    expect(uidsFromSearch([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
});
