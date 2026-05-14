'use client';

import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { getEnv } from '@/lib/env';

const GITHUB_RELEASES_BASE =
  'https://github.com/tale-project/tale/releases/tag';

// True when `candidate` is strictly newer than `baseline` using
// dot-separated integer comparison (e.g. "1.10.0" > "1.9.9"). Missing
// baseline means "never acknowledged" → treat anything as newer.
export function isNewer(
  candidate: string,
  baseline: string | undefined | null,
): boolean {
  if (!baseline) return true;
  const parse = (v: string) =>
    v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(baseline);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai > bi;
  }
  return false;
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
  releaseUrl: string | null;
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

  const releaseUrl = currentVersion
    ? `${GITHUB_RELEASES_BASE}/v${currentVersion}`
    : null;

  return {
    currentVersion,
    lastSeenVersion: state?.lastSeenChangelogVersion ?? undefined,
    stateLoaded,
    hasUnseenVersion,
    shouldShowToast,
    releaseUrl,
    markSeen: () => {
      if (!currentVersion) return;
      void markSeenMutation({ version: currentVersion });
    },
    markToasted: () => {
      if (!currentVersion) return;
      void markToastedMutation({ version: currentVersion });
    },
  };
}
