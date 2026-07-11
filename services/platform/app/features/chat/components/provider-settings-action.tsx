'use client';

import { LinkButton } from '@tale/ui/button';
import { Settings } from 'lucide-react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

/**
 * Owner / admin / developer can reach Settings → AI providers and add a key —
 * the same `developerSettings` gate the providers route itself uses. Members
 * without it are pointed at an admin instead.
 */
export function useCanManageProviders(): boolean {
  return useAbility().can('read', 'developerSettings');
}

/**
 * Inline "Open provider settings" affordance for the missing-API-key chat error.
 * Renders the deep link for members who can manage providers, and an
 * "ask an admin" hint for everyone else.
 */
export function ProviderKeyErrorAction({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('chat');
  const canManage = useCanManageProviders();

  if (!canManage) {
    return (
      <p className="text-muted-foreground text-[13px]">
        {t('askAdminProviderKey')}
      </p>
    );
  }

  return (
    <LinkButton
      variant="secondary"
      size="sm"
      icon={Settings}
      href="/dashboard/$id/settings/providers"
      params={{ id: organizationId }}
      className="w-fit gap-1.5"
    >
      {t('openProviderSettings')}
    </LinkButton>
  );
}
