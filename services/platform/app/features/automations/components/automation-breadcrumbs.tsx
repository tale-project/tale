'use client';

/**
 * The adaptive-header trail for one automation (and its runs).
 *
 * On the automation page: `Automations / <name>` — the Automations crumb
 * always returns to the org Automations hub (the project has no Automations
 * tab; its `/automations` list sits under Projects chrome and reads as a
 * detour). On a run page: `Automations / <name> / Run` — the name crumb
 * returns to this automation (project-scoped when opened from a project),
 * and the mobile back arrow follows that immediate parent.
 */

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link, useMatch } from '@tanstack/react-router';

import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@/app/components/layout/header-breadcrumbs';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { useAutomation } from '../hooks/queries';

export function AutomationBreadcrumbs({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** When set, the automation name crumb (on a run) stays on the project route. */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const automationQuery = useAutomation(organizationId, automationSlug);
  const displayName = automationDisplayName(
    automationQuery.data?.presentation,
    automationSlug,
    locale,
  );
  const slugParam = automationSlugToParam(automationSlug);

  // Either shell can host a run under this slug; the trail only cares that
  // we ARE on a run, so the name crumb can point back at the automation.
  const onOrgRun =
    useMatch({
      from: '/dashboard/$id/automations/$automationSlug/runs/$runId',
      shouldThrow: false,
    }) !== undefined;
  const onProjectRun =
    useMatch({
      from: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
      shouldThrow: false,
    }) !== undefined;
  const onRun = onOrgRun || onProjectRun;

  // Always the org hub — project-scoped `/automations` renders inside the
  // project shell (Projects / …), which is not what this crumb names.
  const listCrumb = (
    <Link
      to="/dashboard/$id/automations"
      params={{ id: organizationId }}
      activeOptions={{ exact: true }}
      className={HEADER_CRUMB_LINK_CLASS}
    >
      {t('title')}
    </Link>
  );

  const automationCrumb =
    projectId !== undefined ? (
      <Link
        to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
        params={{
          id: organizationId,
          projectId,
          automationSlug: slugParam,
        }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {displayName}
      </Link>
    ) : (
      <Link
        to="/dashboard/$id/automations/$automationSlug"
        params={{ id: organizationId, automationSlug: slugParam }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {displayName}
      </Link>
    );

  const nameLeaf = (
    <Skeletonize
      loading={automationQuery.isPending}
      label={t('title')}
      className="contents"
    >
      {automationQuery.isPending ? (
        <SkeletonBox>
          <span className="inline-block h-4 w-32 align-middle" />
        </SkeletonBox>
      ) : (
        displayName
      )}
    </Skeletonize>
  );

  return (
    <HeaderBreadcrumbs
      ariaLabel={tCommon('aria.breadcrumb')}
      crumbs={
        onRun
          ? [
              { key: 'automations', content: listCrumb },
              { key: 'automation', content: automationCrumb },
            ]
          : [{ key: 'automations', content: listCrumb }]
      }
      leaf={onRun ? t('runs.breadcrumb') : nameLeaf}
    />
  );
}
