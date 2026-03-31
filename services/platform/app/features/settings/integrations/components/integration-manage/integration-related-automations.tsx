'use client';

import { ChevronDown, ChevronRight, ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Button, LinkButton } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { CreateAutomationDialog } from '@/app/features/automations/components/automation-create-dialog';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface IntegrationRelatedAutomationsProps {
  integrationName: string;
  organizationId: string;
  isLast?: boolean;
}

export function IntegrationRelatedAutomations({
  integrationName,
  organizationId,
  isLast,
}: IntegrationRelatedAutomationsProps) {
  const { t } = useT('settings');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { data: automations, isLoading } = useConvexQuery(
    api.integrations.queries.listRelatedAutomations,
    { organizationId, integrationName },
  );

  const count = automations?.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3"
      >
        <span className="text-foreground text-[13px] leading-tight font-medium tracking-[-0.078px]">
          {t('integrations.manageDialog.relatedAutomations')}
        </span>
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
        <span className="text-muted-foreground ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-border bg-muted border-x px-4 py-3">
          {isLoading ? (
            <div
              className="space-y-2"
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
            <ul className="space-y-1 text-sm" role="list">
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
                      <Text
                        as="span"
                        variant="body"
                        truncate
                        className="min-w-0"
                      >
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
            <Text variant="caption">
              {t('integrations.manageDialog.noRelatedAutomations')}
            </Text>
          )}

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setCreateDialogOpen(true)}
            >
              {t('integrations.manageDialog.createAutomation')}
            </Button>
          </div>
        </div>
      )}

      {!isLast && <div className="bg-border h-px w-full" />}

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
