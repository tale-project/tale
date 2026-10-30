'use client';

import { useCallback } from 'react';

import { useCurrentUser } from '@/app/hooks/use-current-user';
import { usePersistedState } from '@/app/hooks/use-persisted-state';

import { rememberDataNotice } from '../lib/data-notice-boot';
import { useDataClassificationNotice } from './use-data-classification-notice';

export interface ShownDataNotice {
  /** The policy read has answered and the member is known — `message` is
   *  the real answer rather than the hidden stand-in shown until then. */
  settled: boolean;
  /** The text to show, or `null`: not settled yet, the org keeps the notice
   *  off, or this member dismissed this very text. */
  message: string | null;
  /** "Don't show again": hide the text shown now from this member. */
  dismiss: () => void;
}

/** The slot read until the member and org are known. It is never written:
 *  `dismiss` waits for a settled notice, which needs both. */
const UNSCOPED_KEY = 'data-notice-dismissed';

/**
 * Where a member's dismissal of an org's notice is kept — user and org
 * scoped, like the chat drafts (`chatDraftKey`), so a shared machine never
 * hides the notice from another account.
 */
export function dataNoticeDismissalKey(
  userId: string,
  organizationId: string,
): string {
  return `${UNSCOPED_KEY}-${userId}-${organizationId}`;
}

/**
 * The confidentiality notice as this member sees it: the org's notice
 * (`useDataClassificationNotice`) less their own "Don't show again".
 *
 * A dismissal stores the text it hid, in this browser (`usePersistedState`),
 * so that text stays hidden across reloads, and a different one — an admin's
 * edit, or the text of another language — shows again. Turning the notice
 * off and on again with the same text keeps it hidden. The policy's
 * `version` plays no part (see `useDataClassificationNotice`).
 */
export function useShownDataNotice(
  organizationId: string | undefined,
): ShownDataNotice {
  const notice = useDataClassificationNotice(organizationId);
  const userId = useCurrentUser().data?.userId;
  const [dismissedText, setDismissedText] = usePersistedState(
    userId !== undefined && organizationId !== undefined
      ? dataNoticeDismissalKey(userId, organizationId)
      : UNSCOPED_KEY,
    '',
  );

  const settled = notice.settled && userId !== undefined;
  const message =
    settled && notice.enabled && notice.message !== dismissedText
      ? notice.message
      : null;

  const dismiss = useCallback(() => {
    if (message === null || organizationId === undefined) return;
    setDismissedText(message);
    // The next load's skeleton reserves the notice's row from what this
    // device showed last (data-notice-boot.ts) — none, from now on.
    rememberDataNotice(organizationId, null);
  }, [message, organizationId, setDismissedText]);

  return { settled, message, dismiss };
}
