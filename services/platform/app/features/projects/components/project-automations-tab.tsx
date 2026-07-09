'use client';

import { Button } from '@tale/ui/button';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { HStack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Workflow } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useProjectAutomations } from '@/app/features/automations/hooks/use-install-state';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface ProjectAutomationsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

/**
 * Bound project-scoped automations for this project. One list under the
 * project shell — each row opens the automation detail (Automations chrome).
 */
export function ProjectAutomationsTab({
  organizationId,
  projectId,
}: ProjectAutomationsTabProps) {
  const { t } = useT('projects');
  const { automations, isLoading } = useProjectAutomations(projectId);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('automations.title')}
        description={t('automations.description')}
      />

      <FormSection>
        {automations.length > 0 ? (
          <ul
            className="divide-y rounded-lg border"
            aria-label={t('automations.title')}
          >
            {automations.map((automation) => (
              <li key={automation.automationSlug}>
                <Link
                  to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
                  params={{
                    id: organizationId,
                    projectId: String(projectId),
                    automationSlug: automation.automationSlug,
                  }}
                  className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
                >
                  <Workflow
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <HStack
                    gap={2}
                    align="center"
                    className="min-w-0 flex-1"
                    justify="between"
                  >
                    <Text as="span" className="truncate text-sm font-medium">
                      {automation.automationName}
                    </Text>
                    {automation.status === 'broken' ? (
                      <Text
                        as="span"
                        variant="caption"
                        className="text-destructive shrink-0"
                      >
                        {t('automations.statusBroken')}
                      </Text>
                    ) : null}
                  </HStack>
                  <ChevronRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : !isLoading ? (
          <EmptyPlaceholder icon={Workflow}>
            <div className="flex flex-col items-center gap-3">
              <div>
                <Text as="p" className="font-medium">
                  {t('automations.emptyTitle')}
                </Text>
                <Text as="p" variant="muted" className="mt-1">
                  {t('automations.emptyDescription')}
                </Text>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link
                  to="/dashboard/$id/automations"
                  params={{ id: organizationId }}
                  search={{ tab: 'all' }}
                >
                  {t('automations.emptyCta')}
                </Link>
              </Button>
            </div>
          </EmptyPlaceholder>
        ) : null}
      </FormSection>
    </ContentArea>
  );
}
