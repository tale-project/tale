'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Dialog } from '@/app/components/ui/dialog/dialog';
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
  currentVersion: number;
}

export function CustomAgentVersionHistoryDialog({
  open,
  onOpenChange,
  customAgentId,
  currentVersion,
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
                    {t('customAgents.versions.version', { number: version.version })}
                  </span>
                  {version.version === currentVersion && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('customAgents.versions.current')}
                    </span>
                  )}
                </div>
                {version.changeDescription && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {version.changeDescription}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(new Date(version.createdAt), 'medium')}
                </p>
              </div>
              {version.version !== currentVersion && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRollback(version.version)}
                  disabled={rollingBackVersion !== null}
                >
                  {rollingBackVersion === version.version
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
