'use client';

import { useEffect, useRef } from 'react';

import { useAutomationInstallActions } from './use-install-state';

/**
 * Re-check that an installed automation's copied files still exist when one
 * of its pages opens. Guarded by automationSlug so it runs once per
 * automation (verify's identity is unstable and it mutates the install
 * status, which would otherwise re-fire in a loop). Lives on the PAGE hosts
 * (the automation page, the project view pages) — not inside a readiness
 * section — so the check still runs whichever surface opens first.
 */
export function useOpenTimeIntegrityCheck(
  organizationId: string,
  automationSlug: string,
) {
  const { verify } = useAutomationInstallActions(organizationId);
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (verifiedRef.current !== automationSlug) {
      verifiedRef.current = automationSlug;
      void verify(automationSlug);
    }
  }, [automationSlug, verify]);
}
