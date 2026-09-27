'use client';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTabActionsSlot,
} from '@tale/ui/adaptive-header';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { ActiveEditorProvider, useActiveEditor } from '@tale/ui/editor';
import { EmptyState } from '@tale/ui/empty-state';
import { PageLayout } from '@tale/ui/page-layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link, useLocation } from '@tanstack/react-router';
import { SearchX, Trash2 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/navigation/tab-navigation';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useAutomation } from '../hooks/queries';
import { automationDetailPathname } from '../lib/detail-paths';
import { automationDeletedAt, isMissingAutomationRead } from '../lib/errors';
import { AutomationBreadcrumbs } from './automation-breadcrumbs';

/** The editor's controller reports its draft under this key (see `AutomationEditor`). */
const EDITOR_DIRTY_KEYS = ['document'] as const;

interface AutomationDetailShellProps {
  organizationId: string;
  automationSlug: string;
  /** Render under the project shell's routes: tab links and run links stay
   * inside `/projects/$projectId/…`. */
  projectId?: string;
  /** The active tab's page (the route outlet). */
  children: ReactNode;
}

/**
 * The chrome every automation detail page shares, on the org route AND the
 * project-scoped one: the `PageLayout` scroll shell, the
 * `Automations / <name>` breadcrumb (the name doubling as the sibling
 * switcher), and the tab strip — **Editor**, **Versions**, **Runs** — exactly
 * the composition a project detail carries. The strip's trailing slot is
 * where the editor puts its verbs and the Save/Discard cluster, so the header
 * row keeps only the name and the Live badge.
 *
 * `ActiveEditorProvider` is the registry the editor's Save/Discard cluster
 * reads; this shell renders no cluster of its own, so the page keeps exactly
 * one. Navigation blocking needs nothing here: the dashboard layout mounts
 * the single `DirtyBlockerProvider`, and an editor that registers a dirty
 * source arms it.
 *
 * An unknown slug renders the not-found state under the same breadcrumb (so
 * the trail — and the mobile back control — still lead to the list) with no
 * tabs to open. A DELETED automation is not unknown: its run history stays
 * until retention removes it, so the Runs pages still render — under a
 * banner naming the deletion date — while Editor and Versions, which have
 * nothing left to show, stay visible but disabled.
 */
export function AutomationDetailShell(props: AutomationDetailShellProps) {
  return (
    <ActiveEditorProvider>
      <AutomationDetailFrame {...props} />
    </ActiveEditorProvider>
  );
}

function AutomationDetailFrame({
  organizationId,
  automationSlug,
  projectId,
  children,
}: AutomationDetailShellProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const { pathname } = useLocation();
  const automationQuery = useAutomation(organizationId, automationSlug);
  // The strip's per-tab unsaved dot: the Editor tab lights up while the
  // editor holds a draft, the same indicator a project's tabs render.
  const activeEditor = useActiveEditor();
  const deletedAt = automationDeletedAt(automationQuery.error);

  const root = automationDetailPathname({
    organizationId,
    automationSlug,
    ...(projectId !== undefined && { projectId }),
  });
  const onRuns =
    pathname === `${root}/runs` || pathname.startsWith(`${root}/runs/`);

  const tabs = useMemo<TabNavigationItem[]>(() => {
    const deleted = deletedAt !== undefined;
    return [
      {
        label: t('navigation.editor'),
        href: `${root}/editor`,
        matchMode: 'exact',
        dirtyKeys: EDITOR_DIRTY_KEYS,
        disabled: deleted,
      },
      {
        label: t('navigation.versions'),
        href: `${root}/versions`,
        matchMode: 'exact',
        disabled: deleted,
      },
      {
        // A run's own page is a sub-view of Runs, so the tab stays lit there.
        label: t('navigation.runs'),
        href: `${root}/runs`,
        matchMode: 'startsWith',
      },
    ];
  }, [t, root, deletedAt]);

  const breadcrumbs = (
    <AutomationBreadcrumbs
      organizationId={organizationId}
      automationSlug={automationSlug}
      {...(projectId !== undefined && { projectId })}
    />
  );

  if (isMissingAutomationRead(automationQuery) && deletedAt === undefined) {
    return (
      <PageLayout
        organizationId={organizationId}
        header={
          // No tab strip follows, so the title row carries the divider itself.
          <AdaptiveHeaderRoot standalone={false} showBorder className="gap-2">
            {breadcrumbs}
          </AdaptiveHeaderRoot>
        }
      >
        <ContentArea variant="narrow">
          <EmptyState
            icon={SearchX}
            title={t('notFound.title')}
            description={t('notFound.description')}
            headingLevel={2}
          />
        </ContentArea>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false} tabsFollow className="gap-2">
            {breadcrumbs}
          </AdaptiveHeaderRoot>
          <TabNavigation
            items={tabs}
            standalone={false}
            ariaLabel={tCommon('aria.automationsNavigation')}
            {...(activeEditor?.dirtyKeys !== undefined && {
              dirtyKeys: activeEditor.dirtyKeys,
            })}
          >
            <AdaptiveHeaderTabActionsSlot />
          </TabNavigation>
        </>
      }
    >
      {/* Fill the layout's content height so the Editor tab's workbench can
          take the room the strip leaves; auto-height tabs (the Versions and
          Runs lists) size to content and top-align as before. */}
      <Skeletonize
        loading={automationQuery.isPending}
        label={t('title')}
        className="flex min-h-0 flex-1 flex-col"
      >
        {deletedAt === undefined ? (
          children
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <ContentArea className="pb-0">
              <Alert
                variant="info"
                description={t('detail.deleted.banner', {
                  date: formatDate(new Date(deletedAt), 'long'),
                })}
              />
            </ContentArea>
            {onRuns ? (
              children
            ) : (
              <ContentArea variant="narrow">
                <EmptyState
                  icon={Trash2}
                  title={t('detail.deleted.title')}
                  description={t('detail.deleted.description')}
                  headingLevel={2}
                  action={
                    <Button asChild variant="secondary">
                      <Link
                        {...(projectId === undefined
                          ? {
                              to: '/dashboard/$id/automations/$automationSlug/runs' as const,
                              params: {
                                id: organizationId,
                                automationSlug:
                                  automationSlugToParam(automationSlug),
                              },
                            }
                          : {
                              to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs' as const,
                              params: {
                                id: organizationId,
                                projectId,
                                automationSlug:
                                  automationSlugToParam(automationSlug),
                              },
                            })}
                      >
                        {t('detail.deleted.openRuns')}
                      </Link>
                    </Button>
                  }
                />
              </ContentArea>
            )}
          </div>
        )}
      </Skeletonize>
    </PageLayout>
  );
}
