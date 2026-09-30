'use client';

import type { ReactNode } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useAbilityLoading } from '@/app/hooks/use-ability';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { useT } from '@/lib/i18n/client';
import { documentTitle } from '@/lib/utils/seo';

import { useCanUseAutomations } from '../hooks/use-can-use-automations';

/**
 * Closes every automation page to someone who may not use Automations (see
 * `useCanUseAutomations`), so a bookmark or a typed URL reaches no more than
 * the hidden navigation does.
 *
 * An author gets the page even while the role is still resolving: the shell
 * hands over the last known role, and holding the page back on every
 * membership refetch would unmount an open editor and its unsaved draft.
 * Anyone else sees nothing until the role resolves, so a role raised since
 * the last visit never flashes the denial first.
 *
 * The denial names the section on the browser tab, never an automation: a
 * detail route's `head` titles the page from what its loader read when it
 * opened, and a role lowered while it is open reruns no loader.
 */
export function AutomationsAccessGate({ children }: { children: ReactNode }) {
  const canUse = useCanUseAutomations();
  const abilityLoading = useAbilityLoading();
  const { t } = useT('accessDenied');
  const denied = !canUse && !abilityLoading;

  useDocumentTitle(denied ? documentTitle('automations') : undefined);

  if (canUse) return children;
  if (abilityLoading) return null;
  return <AccessDenied message={t('automations')} />;
}
