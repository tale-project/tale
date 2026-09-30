import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { cachedAbility, loaderAbility } from '@/app/lib/loader-preload';
import type { RouterContext } from '@/app/router';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { i18n } from '@/lib/i18n/i18n';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { canUseAutomations } from './access';

/**
 * The display name an automation detail route hands `head()` for the
 * document title, organization and project scope alike.
 *
 * Warms the gating automation query so the breadcrumb paints without a
 * skeleton — the list's row-hover preload runs this too, so it resolves from
 * cache on that common path. A failed fetch falls back to the generic
 * `metadata.automation` title, and the shell's own query still surfaces the
 * real not-found state. Someone who may not use Automations gets the denial,
 * which names no automation — nor does a title whose viewer's role cannot
 * be read. On a cold deep link the role is read beside the automation, so an
 * author waits no longer for the title.
 */
export async function loadAutomationName(
  context: RouterContext,
  organizationId: string,
  automationSlug: string,
): Promise<string | undefined> {
  const cached = cachedAbility(context, organizationId);
  if (cached !== null && !canUseAutomations(cached)) return undefined;
  const name = paramToAutomationSlug(automationSlug);
  const [ability, automation] = await Promise.all([
    loaderAbility(context, organizationId),
    ensureAdaptedQueryData(
      context.queryClient,
      'automations/queries:getAutomation',
      { organizationId, name },
    ).catch((error: unknown) => {
      console.warn('Failed to load automation for document title', error);
      return null;
    }),
  ]);
  if (automation === null || ability === null) return undefined;
  if (!canUseAutomations(ability)) return undefined;
  return automationDisplayName(automation.presentation, name, i18n.language);
}
