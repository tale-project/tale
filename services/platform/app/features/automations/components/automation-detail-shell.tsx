'use client';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTabActionsSlot,
} from '@tale/ui/adaptive-header';
import { ContentArea } from '@tale/ui/content-area';
import { ActiveEditorProvider, useActiveEditor } from '@tale/ui/editor';
import { EmptyState } from '@tale/ui/empty-state';
import { PageLayout } from '@tale/ui/page-layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/navigation/tab-navigation';
import { clearNavSection } from '@/app/lib/nav-memory';
import { useT } from '@/lib/i18n/client';

import { useAutomation } from '../hooks/queries';
import { automationDetailPathname } from '../lib/detail-paths';
import { isMissingAutomationRead } from '../lib/errors';
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
 * tabs to open.
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
  const automationQuery = useAutomation(organizationId, automationSlug);
  // The strip's per-tab unsaved dot: the Editor tab lights up while the
  // editor holds a draft, the same indicator a project's tabs render.
  const activeEditor = useActiveEditor();

  const tabs = useMemo<TabNavigationItem[]>(() => {
    const root = automationDetailPathname({
      organizationId,
      automationSlug,
      ...(projectId !== undefined && { projectId }),
    });
    return [
      {
        label: t('navigation.editor'),
        href: `${root}/editor`,
        matchMode: 'exact',
        dirtyKeys: EDITOR_DIRTY_KEYS,
      },
      {
        label: t('navigation.versions'),
        href: `${root}/versions`,
        matchMode: 'exact',
      },
      {
        // A run's own page is a sub-view of Runs, so the tab stays lit there.
        label: t('navigation.runs'),
        href: `${root}/runs`,
        matchMode: 'startsWith',
      },
    ];
  }, [t, organizationId, automationSlug, projectId]);

  const location = useLocation();
  const navigate = useNavigate();

  const breadcrumbs = (
    <AutomationBreadcrumbs
      organizationId={organizationId}
      automationSlug={automationSlug}
      {...(projectId !== undefined && { projectId })}
    />
  );

  // A remembered automation can be deleted or renamed between visits. When the
  // rail RESTORED us here, forget the stale place and fall back to the list
  // rather than leaving the user on a not-found they never asked for. Only the
  // org-scoped section has memory: a project-scoped automation route belongs to
  // the projects section, whose own shell owns it.
  const isMissing = isMissingAutomationRead(automationQuery);
  const wasRestored = location.state.navRestore === true;
  useEffect(() => {
    if (!isMissing || !wasRestored || projectId !== undefined) return;
    clearNavSection(organizationId, 'automations');
    void navigate({
      to: '/dashboard/$id/automations',
      params: { id: organizationId },
      replace: true,
    });
  }, [isMissing, wasRestored, projectId, organizationId, navigate]);

  if (isMissing) {
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
        {children}
      </Skeletonize>
    </PageLayout>
  );
}
