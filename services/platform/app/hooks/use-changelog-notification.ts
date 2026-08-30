'use client';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { compareVersions } from '@/lib/compare-versions';
import { getEnv } from '@/lib/env';

// `candidate` strictly newer than `baseline`. Missing baseline means
// "never acknowledged" → treat anything as newer. Identical strings are
// never newer, whatever their format — this keeps non-semver builds
// (e.g. TALE_VERSION=dev under docker:dev) quiet once their version is
// recorded instead of re-toasting on every render (#2552). Parse
// failures on *differing* values fall back to "newer" so a malformed
// stored value doesn't lock the dot off.
function isNewer(
  candidate: string,
  baseline: string | undefined | null,
): boolean {
  if (!baseline) return true;
  if (candidate === baseline) return false;
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
  /**
   * True when the state has loaded and no notification row exists at all —
   * a fresh install / brand-new account, not an update. The current version
   * should be recorded silently (via `markSeen`) instead of notifying;
   * `ChangelogToastTrigger` owns that seeding.
   */
  needsBaseline: boolean;
  markSeen: () => void;
  markToasted: () => void;
}

export function useChangelogNotification(): ChangelogNotification {
  const currentVersion = getEnv('TALE_VERSION');
  const { data: state } = useBackendQuery(
    'users/notification_state:getUserNotificationState',
    currentVersion ? {} : 'skip',
  );
  const markSeenMutation = useBackendMutation(
    'users/notification_state:markChangelogSeen',
  );
  const markToastedMutation = useBackendMutation(
    'users/notification_state:markToastShown',
  );

  // `state === undefined` means the query is still loading; we hold back
  // toast/dot until we know whether the user has acknowledged the version
  // to avoid a spurious flash.
  const stateLoaded = state !== undefined;

  // `state === null` means no row exists for this user at all: nothing was
  // ever recorded, so there is no previous version to have "updated" from.
  // That is a fresh install (or brand-new account), not an update — showing
  // "update available" / "updated to vX" there is noise. The trigger seeds
  // the baseline instead (see `needsBaseline`), so the NEXT release still
  // notifies. Rows that exist but miss one field keep the old "treat as
  // newer" behaviour: e.g. a user who was toasted but never opened the
  // release notes must keep the unseen dot.
  const isFreshInstall = stateLoaded && state === null;

  const hasUnseenVersion =
    !!currentVersion &&
    stateLoaded &&
    !isFreshInstall &&
    isNewer(currentVersion, state?.lastSeenChangelogVersion ?? null);

  const shouldShowToast =
    !!currentVersion &&
    stateLoaded &&
    !isFreshInstall &&
    isNewer(currentVersion, state?.lastToastedVersion ?? null);

  return {
    currentVersion,
    lastSeenVersion: state?.lastSeenChangelogVersion ?? undefined,
    stateLoaded,
    hasUnseenVersion,
    shouldShowToast,
    needsBaseline: !!currentVersion && isFreshInstall,
    markSeen: () => {
      if (!currentVersion) return;
      markSeenMutation
        .mutateAsync({ version: currentVersion })
        .catch((err: unknown) => {
          console.warn('markChangelogSeen failed', err);
        });
    },
    markToasted: () => {
      if (!currentVersion) return;
      markToastedMutation
        .mutateAsync({ version: currentVersion })
        .catch((err: unknown) => {
          console.warn('markToastShown failed', err);
        });
    },
  };
}
