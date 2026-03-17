'use client';

import { ExternalLink, Network, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Button, LinkButton } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { CreateAutomationDialog } from '@/app/features/automations/components/automation-create-dialog';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface IntegrationRelatedAutomationsProps {
  integrationName: string;
  organizationId: string;
}

export function IntegrationRelatedAutomations({
  integrationName,
  organizationId,
}: IntegrationRelatedAutomationsProps) {
  const { t } = useT('settings');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: automations, isLoading } = useConvexQuery(
    api.integrations.queries.listRelatedAutomations,
    { organizationId, integrationName },
  );

  const count = automations?.length ?? 0;

  return (
    <>
      <CollapsibleDetails
        summary={
          <>
            <Network className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('integrations.manageDialog.relatedAutomations')}</span>
            {isLoading ? (
              <Skeleton
                className="h-5 w-5 rounded-full"
                label={t('integrations.manageDialog.loadingAutomations')}
              />
            ) : (
              <Badge variant="outline" className="text-xs">
                {count}
              </Badge>
            )}
          </>
        }
      >
        {isLoading ? (
          <div
            className="mt-2 ml-6 space-y-2"
            role="status"
            aria-label={t('integrations.manageDialog.loadingAutomations')}
          >
            <Skeleton
              className="h-8 w-full rounded-md"
              label={t('integrations.manageDialog.loadingAutomations')}
            />
            <Skeleton
              className="h-8 w-3/4 rounded-md"
              label={t('integrations.manageDialog.loadingAutomations')}
            />
          </div>
        ) : count > 0 ? (
          <ul className="mt-2 ml-6 space-y-1 text-sm" role="list">
            {automations?.map((automation) => {
              const targetId = automation.activeVersionId ?? automation._id;
              return (
                <li key={automation._id} className="flex items-center gap-2">
                  <LinkButton
                    href="/dashboard/$id/automations/$amId"
                    params={{ id: organizationId, amId: targetId }}
                    variant="ghost"
                    icon={ExternalLink}
                    className="w-full justify-start"
                  >
                    <Text as="span" variant="body" truncate className="min-w-0">
                      {automation.name}
                    </Text>
                    <Badge
                      dot
                      variant={
                        automation.status === 'active' ? 'green' : 'outline'
                      }
                      className="ml-auto shrink-0"
                    >
                      {automation.status}
                    </Badge>
                  </LinkButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <Text variant="caption" className="mt-2 ml-6">
            {t('integrations.manageDialog.noRelatedAutomations')}
          </Text>
        )}

        <div className="mt-3 ml-6">
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => setCreateDialogOpen(true)}
          >
            {t('integrations.manageDialog.createAutomation')}
          </Button>
        </div>
      </CollapsibleDetails>

      <CreateAutomationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
        integrationName={integrationName}
        defaultTab="template"
      />
    </>
  );
}
