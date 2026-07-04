'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { LinkButton, buttonVariants } from '@tale/ui/button';
import type { ToastActionElement } from '@tale/ui/toast';
import { Link } from '@tanstack/react-router';
import { Settings } from 'lucide-react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Owner / admin / developer can reach Settings → AI providers and add a key —
 * the same `developerSettings` gate the providers route itself uses. Members
 * without it are pointed at an admin instead. Kept as a single hook so the
 * toast (chat-input send-block) and the inline chat-error display agree on who
 * gets the link.
 */
export function useCanManageProviders(): boolean {
  return useAbility().can('read', 'developerSettings');
}

/**
 * Toast action that deep-links to the org's AI-provider settings. Wrapped in a
 * Radix `Toast.Action` (so it carries an `altText` for screen readers and
 * dismisses the toast on activation) around a router `Link` — a raw Link, not
 * `LinkButton`, because `Toast.Action asChild` merges its handlers onto the DOM
 * child and `LinkButton` does not forward them.
 */
export function ProviderSettingsToastAction({
  organizationId,
}: {
  organizationId: string;
}): ToastActionElement {
  const { t } = useT('chat');
  const label = t('openProviderSettings');
  return (
    <ToastPrimitives.Action altText={label} asChild>
      <Link
        to="/dashboard/$id/settings/providers"
        params={{ id: organizationId }}
        className={cn(
          buttonVariants({ variant: 'secondary', size: 'sm' }),
          'gap-1.5',
        )}
      >
        <Settings className="size-4" aria-hidden="true" />
        {label}
      </Link>
    </ToastPrimitives.Action>
  );
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
