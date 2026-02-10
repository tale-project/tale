'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Button } from '@/app/components/ui/primitives/button';
import { Stack } from '@/app/components/ui/layout/layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useRollbackCustomAgentVersion } from '../hooks/use-custom-agent-mutations';

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
  const rollback = useRollbackCustomAgentVersion();
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);

  const versions = useQuery(
    api.custom_agents.queries.getCustomAgentVersions,
    open ? { customAgentId: customAgentId as any } : 'skip',
  );

  const handleRollback = async (targetVersion: number) => {
    setRollingBackVersion(targetVersion);
    try {
      await rollback({
        customAgentId: customAgentId as any,
        targetVersion,
      });
      toast({
        title: t('customAgents.rolledBack', { version: targetVersion }),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.rollbackFailed'),
        variant: 'destructive',
      });
    } finally {
      setRollingBackVersion(null);
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
        {versions === undefined ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('customAgents.versions.noVersions')}
          </p>
        ) : (
          versions.map((version) => (
            <div
              key={version._id}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {t('customAgents.versions.version', { number: version.versionNumber })}
                  </span>
                  {version.status === 'draft' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {t('customAgents.versions.draft')}
                    </Badge>
                  )}
                  {version.status === 'active' && (
                    <Badge variant="green" className="text-[10px] px-1.5 py-0">
                      {t('customAgents.versions.active')}
                    </Badge>
                  )}
                  {version.status === 'archived' && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {t('customAgents.versions.archived')}
                    </Badge>
                  )}
                </div>
                {version.changeLog && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {version.changeLog}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(new Date(version._creationTime), 'medium')}
                </p>
              </div>
              {version.status === 'archived' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRollback(version.versionNumber)}
                  disabled={rollingBackVersion !== null}
                >
                  {rollingBackVersion === version.versionNumber
                    ? t('customAgents.versions.rollingBack')
                    : t('customAgents.versions.rollback')}
                </Button>
              )}
            </div>
          ))
        )}
      </Stack>
    </Dialog>
  );
}
