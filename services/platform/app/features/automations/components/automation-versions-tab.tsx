'use client';

import { ContentArea } from '@tale/ui/content-area';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { toast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';

import { useAutomation, useAutomationLiveDeployment } from '../hooks/queries';
import { useDeployVersion } from '../hooks/use-deploy-version';
import { rawDocumentOf } from '../lib/draft-document';
import { automationErrorMessage } from '../lib/errors';
import { downloadYaml, sourceFileName, yamlSource } from '../lib/yaml-source';
import {
  type DeployedTrigger,
  TriggerDeployNotice,
} from './trigger-deploy-notice';
import { DeployRefusedDialog } from './versions/deploy-refused-dialog';
import { DeploymentHistoryTable } from './versions/deployment-history-table';
import { LiveVersionCard } from './versions/live-version-card';
import { RestoreVersionDialog } from './versions/restore-version-dialog';
import { VersionHistoryTable } from './versions/version-history-table';

/** The two views of the history: the versions, and when each went live. */
export type VersionsView = 'versions' | 'deployments';

function isVersionsView(value: unknown): value is VersionsView {
  return value === 'versions' || value === 'deployments';
}

/**
 * The Versions tab: what is live, every version saved, and every time one
 * went live. Deploying, rolling back and restoring happen here in one click
 * each — the page names the live version it shows, so a deploy someone else
 * made meanwhile is refused rather than undone.
 */
export function AutomationVersionsTab({
  organizationId,
  automationSlug,
  projectId,
  view,
  onViewChange,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep the editor links inside the project shell. */
  projectId?: string;
  view: VersionsView;
  onViewChange: (view: VersionsView) => void;
}) {
  const { t } = useT('automations');
  const ability = useAbility();
  const canAuthor = ability.can('read', 'developerSettings');
  const queryClient = useQueryClient();
  const automationQuery = useAutomation(organizationId, automationSlug);
  const liveQuery = useAutomationLiveDeployment(organizationId, automationSlug);
  // A failed read's retry hands its focus here once the rows arrive.
  const headingRef = useRef<HTMLSpanElement>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [triggerOff, setTriggerOff] = useState<DeployedTrigger | null>(null);

  const deployer = useDeployVersion({
    organizationId,
    automationSlug,
    onShowDeployments: () => onViewChange('deployments'),
    onTriggerOff: setTriggerOff,
  });

  // The tables and the restore dialog only start deploys; a stable handle
  // keeps their rows from rebuilding while one runs.
  const deployOnly = useMemo(
    () => ({ deploy: deployer.deploy }),
    [deployer.deploy],
  );

  // What the page shows as live — the deploy's compare-and-set. The live
  // read answers first-hand; until it has, the automation's own read.
  const liveVersion =
    liveQuery.data === undefined
      ? (automationQuery.data?.deployedVersion ?? null)
      : (liveQuery.data.live?.version ?? null);
  const latestVersion =
    automationQuery.data?.latestVersion ?? automationQuery.data?.version;

  const download = useCallback(
    (version: number) => {
      ensureAdaptedQueryData(queryClient, 'automations/queries:getAutomation', {
        organizationId,
        name: automationSlug,
        version,
      })
        .then((detail) => {
          const document = rawDocumentOf(detail?.document);
          if (document === null) {
            throw new Error(`v${version} has no document to download`);
          }
          downloadYaml(
            yamlSource(document),
            sourceFileName(automationSlug, version, false),
          );
        })
        .catch((error: unknown) => {
          console.warn(
            '[automations] a version could not be downloaded',
            error,
          );
          toast({
            title: t('versions.actions.downloadFailed', { version }),
            description: automationErrorMessage(error),
            variant: 'destructive',
          });
        });
    },
    [queryClient, organizationId, automationSlug, t],
  );

  const restoreVersion = useCallback((version: number) => {
    setRestoring(version);
  }, []);

  return (
    <ContentArea gap={6}>
      <StickySectionHeader
        as="h2"
        title={
          <span ref={headingRef} tabIndex={-1}>
            {t('versions.title')}
          </span>
        }
        description={t('versions.description')}
      />
      <LiveVersionCard
        organizationId={organizationId}
        automationSlug={automationSlug}
        canAuthor={canAuthor}
        latestVersion={latestVersion}
        deployer={deployer}
      />
      {triggerOff !== null && (
        <TriggerDeployNotice
          place={{ organizationId, projectId, name: automationSlug }}
          trigger={triggerOff}
        />
      )}
      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label={t('versions.tabs.label')}
          value={view}
          onValueChange={(next) => {
            if (isVersionsView(next)) onViewChange(next);
          }}
          options={[
            { value: 'versions', label: t('versions.tabs.versions') },
            { value: 'deployments', label: t('versions.tabs.deployments') },
          ]}
          className="self-start"
        />
        {view === 'versions' ? (
          <VersionHistoryTable
            organizationId={organizationId}
            automationSlug={automationSlug}
            projectId={projectId}
            canAuthor={canAuthor}
            latestVersion={latestVersion}
            liveVersion={liveVersion}
            deployer={deployOnly}
            onRestore={restoreVersion}
            onDownload={download}
            onErrorFocusLost={() => headingRef.current?.focus()}
          />
        ) : (
          <DeploymentHistoryTable
            organizationId={organizationId}
            automationSlug={automationSlug}
            projectId={projectId}
            canAuthor={canAuthor}
            liveVersion={liveVersion}
            deployer={deployOnly}
            onErrorFocusLost={() => headingRef.current?.focus()}
          />
        )}
      </div>
      <DeployRefusedDialog
        organizationId={organizationId}
        automationSlug={automationSlug}
        projectId={projectId}
        refusal={deployer.refusal}
        onClose={deployer.closeRefusal}
      />
      {latestVersion !== undefined && (
        <RestoreVersionDialog
          organizationId={organizationId}
          automationSlug={automationSlug}
          projectId={projectId}
          version={restoring}
          latestVersion={latestVersion}
          liveVersion={liveVersion}
          canDeploy={canAuthor}
          deployer={deployOnly}
          onClose={() => setRestoring(null)}
        />
      )}
    </ContentArea>
  );
}
