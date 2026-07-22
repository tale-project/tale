'use client';

import { LinkButton } from '@tale/ui/button';
import { LayoutGrid } from 'lucide-react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

/**
 * Inline next-step for the no-agents composer block. Writers get a deep link
 * to Automations (where agents are installed now); Members get an ask-admin
 * hint — they cannot open Agents or Automations themselves.
 */
export function NoAgentsErrorAction({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('chat');
  const canManageAgents = useAbility().can('write', 'agents');

  if (!canManageAgents) {
    return (
      <p className="text-muted-foreground text-[13px]">
        {t('askAdminInstallAgent')}
      </p>
    );
  }

  return (
    <LinkButton
      variant="secondary"
      size="sm"
      icon={LayoutGrid}
      href="/dashboard/$id/automations"
      params={{ id: organizationId }}
      className="w-fit gap-1.5"
    >
      {t('agentSelector.browseAutomations')}
    </LinkButton>
  );
}
