/**
 * Select message UIDs to fetch from an open IMAP mailbox.
 */

export interface UidSelectionContext {
  searchUids: number[] | false | null | undefined;
  searchThrew: boolean;
  mailboxExists: number;
  sentFolder: boolean;
  maxResults: number;
}

/** Decide whether to fall back from SEARCH to a recent sequence fetch. */
export function shouldUseRecentSentFetch(ctx: UidSelectionContext): boolean {
  if (!ctx.sentFolder || ctx.mailboxExists === 0) {
    return false;
  }
  if (ctx.searchThrew) {
    return true;
  }
  const uids = ctx.searchUids;
  if (!uids || uids.length === 0) {
    return true;
  }
  return false;
}

export function uidsFromSearch(
  searchUids: number[] | false | null | undefined,
  maxResults: number,
): number[] {
  if (!searchUids || searchUids.length === 0) {
    return [];
  }
  return searchUids.slice(-maxResults);
}
