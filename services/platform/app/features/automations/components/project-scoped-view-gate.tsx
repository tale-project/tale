'use client';

/**
 * Org-route empty state for a project-scoped automation's bundled view.
 * The desk (and any other `$projectId`-bound view) cannot load data without a
 * project; this panel lists the currently bound projects as "Open in …" links
 * (same destinations as Configuration → Bound projects) so the operator can
 * jump into a working context without hunting the Configuration tab.
 */
import { Alert } from '@tale/ui/alert';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationBindings } from '../hooks/use-install-state';

export function ProjectScopedViewGate({
  organizationId,
  automationSlug,
  firstViewId,
  children,
}: {
  organizationId: string;
  automationSlug: string;
  /** Deep-link the project-nested page onto this view tab when set. */
  firstViewId?: string;
  children: ReactNode;
}) {
  const { t } = useT('automations');
  const { bindings, isLoading } = useAutomationBindings(
    organizationId,
    automationSlug,
  );

  return (
    <VStack gap={4}>
      <Alert title={t('membership.viewNeedsProjectTitle')}>
        <Text variant="muted" className="text-sm">
          {t('membership.viewNeedsProjectDescription')}
        </Text>
        {!isLoading && bindings.length > 0 && (
          <ul
            className="mt-2 flex flex-col gap-1"
            aria-label={t('membership.boundProjectLinksLabel')}
          >
            {bindings.map(({ projectId, projectName }) => (
              <li key={projectId}>
                <Link
                  to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
                  params={{
                    id: organizationId,
                    projectId,
                    automationSlug,
                  }}
                  {...(firstViewId !== undefined
                    ? { search: { tab: firstViewId } }
                    : {})}
                  className="text-primary text-sm hover:underline"
                >
                  {t('membership.openBoundProject', { name: projectName })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Alert>
      {children}
    </VStack>
  );
}
