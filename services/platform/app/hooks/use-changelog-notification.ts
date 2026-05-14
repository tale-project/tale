'use client';

import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { compareVersions } from '@/lib/compare-versions';
import { getEnv } from '@/lib/env';

// `candidate` strictly newer than `baseline`. Missing baseline means
// "never acknowledged" → treat anything as newer. Parse failures fall
// back to "newer" so a malformed stored value doesn't lock the dot off.
function isNewer(
  candidate: string,
  baseline: string | undefined | null,
): boolean {
  if (!baseline) return true;
  try {
    return compareVersions(candidate, baseline) > 0;
  } catch (err) {
    console.warn(
      `useChangelogNotification: compare failed (${candidate} vs ${baseline})`,
      err,
    );
    return true;
  }
}

interface ChangelogNotification {
  currentVersion: string | undefined;
  lastSeenVersion: string | undefined;
  /**
   * False while the notification-state Convex query is still resolving.
   * Use this to distinguish `lastSeenVersion === undefined` meaning
   * "no row yet" from "still loading".
   */
  stateLoaded: boolean;
  hasUnseenVersion: boolean;
  shouldShowToast: boolean;
  markSeen: () => void;
  markToasted: () => void;
}

export function useChangelogNotification(): ChangelogNotification {
  const currentVersion = getEnv('TALE_VERSION');
  const state = useQuery(
    api.users.notification_state.getUserNotificationState,
    currentVersion ? {} : 'skip',
  );
  const markSeenMutation = useMutation(
    api.users.notification_state.markChangelogSeen,
  );
  const markToastedMutation = useMutation(
    api.users.notification_state.markToastShown,
  );

  // `state === undefined` means the query is still loading; we hold back
  // toast/dot until we know whether the user has acknowledged the version
  // to avoid a spurious flash.
  const stateLoaded = state !== undefined;

  const hasUnseenVersion =
    !!currentVersion &&
    stateLoaded &&
    isNewer(currentVersion, state?.lastSeenChangelogVersion ?? null);

  const shouldShowToast =
    !!currentVersion &&
    stateLoaded &&
    isNewer(currentVersion, state?.lastToastedVersion ?? null);

  return {
    currentVersion,
    lastSeenVersion: state?.lastSeenChangelogVersion ?? undefined,
    stateLoaded,
    hasUnseenVersion,
    shouldShowToast,
    markSeen: () => {
      if (!currentVersion) return;
      markSeenMutation({ version: currentVersion }).catch((err) => {
        console.warn('markChangelogSeen failed', err);
      });
    },
    markToasted: () => {
      if (!currentVersion) return;
      markToastedMutation({ version: currentVersion }).catch((err) => {
        console.warn('markToastShown failed', err);
      });
    },
  };
}
