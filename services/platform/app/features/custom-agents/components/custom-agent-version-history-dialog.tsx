'use client';

import { useState } from 'react';

import type { VersionStatus } from '@/lib/shared/schemas/custom_agents';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

import { useCustomAgentVersionCollection } from '../hooks/collections';
import { useActivateCustomAgentVersion } from '../hooks/mutations';
import { useCustomAgentVersions } from '../hooks/queries';

const STATUS_BADGE_CONFIG: Record<
  VersionStatus,
  { variant: 'outline' | 'green'; labelKey: string }
> = {
  draft: { variant: 'outline', labelKey: 'customAgents.versions.draft' },
  active: { variant: 'green', labelKey: 'customAgents.versions.active' },
  archived: { variant: 'outline', labelKey: 'customAgents.versions.archived' },
};

interface CustomAgentVersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customAgentId: string;
}

export function CustomAgentVersionHistoryDialog({
  open,
  onOpenChange,
  customAgentId,
}: CustomAgentVersionHistoryDialogProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const activateVersion = useActivateCustomAgentVersion();
  const [activatingVersion, setActivatingVersion] = useState<number | null>(
    null,
  );

  const customAgentVersionCollection = useCustomAgentVersionCollection(
    open ? customAgentId : undefined,
  );
  const { versions, isLoading: isLoadingVersions } = useCustomAgentVersions(
    customAgentVersionCollection,
  );

  const hasActiveVersion =
    versions?.some((v) => v.status === 'active') ?? false;

  const handleActivate = async (targetVersion: number) => {
    setActivatingVersion(targetVersion);
    try {
      await activateVersion({
        customAgentId: toId<'customAgents'>(customAgentId),
        targetVersion,
      });
      toast({
        title: t('customAgents.agentPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentPublishFailed'),
        variant: 'destructive',
      });
    } finally {
      setActivatingVersion(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customAgents.versions.title')}
      className="max-h-[80vh] overflow-y-auto"
    >
      <Stack gap={2}>
        {isLoadingVersions ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))
        ) : !versions || versions.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {t('customAgents.versions.noVersions')}
          </p>
        ) : (
          versions.map((version) => (
            <div
              key={version._id}
              className="border-border flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {t('customAgents.versions.version', {
                      number: version.versionNumber,
                    })}
                  </span>
                  {(() => {
                    const status: VersionStatus = version.status;
                    return (
                      <Badge
                        variant={STATUS_BADGE_CONFIG[status].variant}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {t(STATUS_BADGE_CONFIG[status].labelKey)}
                      </Badge>
                    );
                  })()}
                </div>
                {version.changeLog && (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {version.changeLog}
                  </p>
                )}
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatDate(new Date(version._creationTime), 'medium')}
                </p>
              </div>
              {version.status === 'archived' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleActivate(version.versionNumber)}
                  disabled={activatingVersion !== null || hasActiveVersion}
                >
                  {activatingVersion === version.versionNumber
                    ? t('customAgents.versions.activating')
                    : t('customAgents.versions.activate')}
                </Button>
              )}
            </div>
          ))
        )}
      </Stack>
    </Dialog>
  );
}
