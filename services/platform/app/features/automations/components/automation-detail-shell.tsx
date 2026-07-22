'use client';

/**
 * Shared page chrome for EVERY automation detail state — pre-install details,
 * add-to-project prompt, installed body, run detail: the `PageLayout` scroll shell,
 * the "Automations / <name>" breadcrumb (the shared `HeaderBreadcrumbs`
 * trail), and — for the installed body — the shared routed-look tab strip
 * (`TabNavigation`) whose trailing slot carries the active editor's
 * Save/Discard plus the automation's own actions. The same shell renders on
 * the org route AND the project route, so a project-scoped automation reads
 * "Automations / …" everywhere instead of hiding inside the project shell.
 */
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@/app/components/layout/header-breadcrumbs';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useActiveEditor } from '@/app/components/ui/editor';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

import { AutomationBreadcrumbSwitcher } from './automation-breadcrumb-switcher';

export function AutomationDetailShell({
  organizationId,
  automationSlug,
  projectId,
  displayName,
  isLoading = false,
  tabs,
  tabsChildren,
  children,
}: {
  organizationId: string;
  /** Current automation slug — enables the sibling switcher on the leaf. */
  automationSlug?: string;
  /** When set, the switcher keeps navigation on the project-scoped route. */
  projectId?: string;
  /** Localized automation name for the breadcrumb leaf; absent while loading. */
  displayName?: string;
  isLoading?: boolean;
  /** The installed body's tab strip; omit for tab-less states. */
  tabs?: TabNavigationItem[];
  /** Trailing tab-strip slot (EditorActions / Assistant / lifecycle ⋯). */
  tabsChildren?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  // The active tab's editor controller (null on tab-less states / tabs with
  // no form). Feeds the strip's per-tab amber unsaved dot: any tab whose
  // `dirtyKeys` intersect the controller's lights up — the same indicator the
  // agent settings tabs render (#2573).
  const activeEditor = useActiveEditor();
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <HeaderBreadcrumbs
              ariaLabel={tCommon('aria.breadcrumb')}
              crumbs={[
                {
                  key: 'automations',
                  content: (
                    <Link
                      to="/dashboard/$id/automations"
                      params={{ id: organizationId }}
                      activeOptions={{ exact: true }}
                      className={HEADER_CRUMB_LINK_CLASS}
                    >
                      {t('title')}
                    </Link>
                  ),
                },
              ]}
              leaf={
                <Skeletonize
                  loading={isLoading && !displayName}
                  label={t('title')}
                  className="contents"
                >
                  {displayName && automationSlug ? (
                    <AutomationBreadcrumbSwitcher
                      organizationId={organizationId}
                      automationSlug={automationSlug}
                      displayName={displayName}
                      projectId={projectId}
                    />
                  ) : displayName ? (
                    displayName
                  ) : (
                    <SkeletonBox>
                      <span className="inline-block h-4 w-32 align-middle" />
                    </SkeletonBox>
                  )}
                </Skeletonize>
              }
            />
          </AdaptiveHeaderRoot>
          {tabs && (
            <TabNavigation
              items={tabs}
              standalone={false}
              matchMode="exact"
              ariaLabel={t('tabs.ariaLabel')}
              dirtyKeys={activeEditor?.dirtyKeys}
            >
              {tabsChildren}
            </TabNavigation>
          )}
        </>
      }
    >
      {children}
    </PageLayout>
  );
}
