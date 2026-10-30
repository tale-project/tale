'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ChangeSummary } from '@tale/ui/change-list';
import { CodeDiff, type CodeDiffLayout } from '@tale/ui/code-diff';
import { ContentArea } from '@tale/ui/content-area';
import { EmptyState } from '@tale/ui/empty-state';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { ErrorDisplayCompact } from '@tale/ui/error-boundaries/error-display-compact';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Select } from '@tale/ui/select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Download,
  GitCompare,
  Radio,
  Rocket,
  RotateCcw,
  SearchX,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { readStateOf } from '@/app/lib/backend/read-state';
import { diffAutomationDocuments } from '@/lib/engine/core/diff/automation';
import { changeSummaryOf } from '@/lib/engine/core/diff/changes';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../../hooks/backend';
import {
  useAutomation,
  useAutomationAtVersion,
  useAutomationVersions,
  useNodeTypeCatalog,
} from '../../hooks/queries';
import { useActorLabel } from '../../hooks/use-actor-label';
import { useDeployVersion } from '../../hooks/use-deploy-version';
import { useDownloadVersion } from '../../hooks/use-download-version';
import { editorVersionLink, versionsTabLink } from '../../lib/detail-paths';
import { readDocument } from '../../lib/document';
import type { VersionCompareView } from '../../lib/editor-search';
import { isMissingAutomationRead } from '../../lib/errors';
import { nodeCatalogView } from '../../lib/node-face';
import {
  changeFlags,
  compareOptions,
  versionBefore,
} from '../../lib/version-changes';
import { AUTOMATION_WORKBENCH_COMPACT_QUERY } from '../../lib/workbench';
import { yamlSource } from '../../lib/yaml-source';
import {
  type DeployedTrigger,
  TriggerDeployNotice,
} from '../trigger-deploy-notice';
import { DeployRefusedDialog } from './deploy-refused-dialog';
import { RestoreVersionDialog } from './restore-version-dialog';
import { AuthorNamesLoadError, VersionAuthor } from './version-author';
import {
  itemsOfBox,
  useVersionChangeSections,
  VersionChanges,
} from './version-changes';
import { VersionGraph } from './version-graph';

/** What a comparison's address holds besides the compared version. */
export interface VersionCompareSearch {
  from?: number | undefined;
  view?: VersionCompareView | undefined;
  node?: string | undefined;
}

type VersionDetail = NonNullable<
  ReturnType<typeof useAutomationAtVersion>['data']
>;

/** What a version keeps beside its document, for the comparison. */
function packageOf(detail: VersionDetail | null | undefined) {
  if (detail === null || detail === undefined) return null;
  return {
    ...(detail.settings !== undefined && { settings: detail.settings }),
    ...(detail.taskContract !== undefined && {
      taskContract: detail.taskContract,
    }),
    ...(detail.presentation !== undefined && {
      presentation: detail.presentation,
    }),
  };
}

function isView(value: string): value is VersionCompareView {
  return value === 'graph' || value === 'changes' || value === 'yaml';
}

/**
 * What changed from one version of an automation to another: the version's
 * message, who saved it and how, and what can be done with it — opened in
 * the editor, put live, restored, downloaded — over the changes as a graph
 * of both versions, as a list of what changed, or as the two versions'
 * YAML. It compares with the version before it unless another is chosen.
 */
export function VersionComparePage({
  organizationId,
  automationSlug,
  projectId,
  version,
  search,
  onSearchChange,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string;
  /** The compared version; null for an address that names none. */
  version: number | null;
  search: VersionCompareSearch;
  onSearchChange: (next: VersionCompareSearch) => void;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const navigate = useNavigate();
  const ability = useAbility();
  const canAuthor = ability.can('read', 'developerSettings');
  const compact = useMediaQuery(AUTOMATION_WORKBENCH_COMPACT_QUERY);
  const [layout, setLayout] = useState<CodeDiffLayout>('unified');
  const [restoring, setRestoring] = useState<number | null>(null);
  const [triggerOff, setTriggerOff] = useState<DeployedTrigger | null>(null);

  const versionsQuery = useAutomationVersions(organizationId, automationSlug);
  const fromVersion =
    search.from ??
    (version === null
      ? undefined
      : versionBefore(
          version,
          versionsQuery.data?.map((entry) => entry.version),
        ));
  const latestQuery = useAutomation(organizationId, automationSlug);
  const afterQuery = useAutomationAtVersion(
    organizationId,
    automationSlug,
    version ?? undefined,
  );
  const beforeQuery = useAutomationAtVersion(
    organizationId,
    automationSlug,
    fromVersion,
  );
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data?.nodeTypes, catalogQuery.data?.connectors],
  );
  const download = useDownloadVersion(organizationId, automationSlug);
  const deployer = useDeployVersion({
    organizationId,
    automationSlug,
    onShowDeployments: () => {
      void navigate(
        versionsTabLink({
          organizationId,
          automationSlug,
          projectId,
          tab: 'deployments',
        }),
      );
    },
    onTriggerOff: setTriggerOff,
  });

  const after = afterQuery.data ?? null;
  // The version compared with may not come: missing (a refusal that says
  // so) or failed (a fault, after its retries). Compared with nothing, every
  // node, test and input would read as added, so there is no diff then.
  const beforeRead = readStateOf(beforeQuery);
  const fromMissing =
    fromVersion !== undefined &&
    !beforeQuery.isPending &&
    isMissingAutomationRead(beforeQuery);
  const fromFailed =
    fromVersion !== undefined && !fromMissing && beforeRead.unavailable;
  const fromUnread = fromMissing || fromFailed;
  const before =
    fromVersion === undefined || fromUnread ? null : (beforeQuery.data ?? null);
  const afterDoc = useMemo(() => readDocument(after?.document), [after]);
  const beforeDoc = useMemo(() => readDocument(before?.document), [before]);
  const diff = useMemo(
    () =>
      afterDoc === null || fromUnread
        ? null
        : diffAutomationDocuments(beforeDoc, afterDoc, {
            beforePackage: packageOf(before),
            afterPackage: packageOf(after),
          }),
    [afterDoc, beforeDoc, before, after, fromUnread],
  );
  const labels = useMemo(
    () => ({
      before:
        fromVersion === undefined
          ? ''
          : t('versions.versionLabel', { version: fromVersion }),
      after: t('versions.versionLabel', { version: version ?? 0 }),
    }),
    [fromVersion, version, t],
  );
  const sections = useVersionChangeSections({
    diff,
    before: beforeDoc,
    after: afterDoc,
    labels,
    catalog,
  });

  // The automation's own read says which version is live and which is the
  // latest: until it answers, the page neither marks the version live nor
  // offers to deploy or restore it, and a read that failed says so.
  const live = latestQuery.data?.deployedVersion ?? null;
  const latest = latestQuery.data?.latestVersion ?? latestQuery.data?.version;
  const latestKnown = latestQuery.data !== undefined;
  const latestRead = readStateOf(latestQuery);
  const actorLabel = useActorLabel(organizationId);
  // A failed read's retry hands its focus here once what it read arrives.
  const headingRef = useRef<HTMLSpanElement>(null);
  const focusHeading = useCallback(() => headingRef.current?.focus(), []);
  const view: VersionCompareView =
    search.view ?? (compact ? 'changes' : 'graph');

  // A number below the latest that is gone was removed by the retention
  // policy (numbers are never reused); a higher one never existed.
  const wasRemoved = (gone: number | null | undefined): boolean =>
    gone !== null &&
    gone !== undefined &&
    latest !== undefined &&
    gone < latest;
  // An address that names no version, or a version this automation does
  // not have, is a dead end with a way back.
  const missingState = (
    <ContentArea variant="narrow">
      <EmptyState
        icon={SearchX}
        title={t(wasRemoved(version) ? 'compare.removed' : 'compare.missing', {
          version: version ?? '?',
        })}
        headingLevel={2}
        action={
          <Button asChild variant="secondary">
            <Link
              {...versionsTabLink({
                organizationId,
                automationSlug,
                projectId,
              })}
            >
              {t('compare.backToVersions')}
            </Link>
          </Button>
        }
      />
    </ContentArea>
  );
  if (version === null) return missingState;
  if (!afterQuery.isPending && isMissingAutomationRead(afterQuery)) {
    return missingState;
  }
  if (afterQuery.isError) {
    return (
      <ContentArea>
        <div role="alert">
          <ErrorDisplayCompact
            error={afterQuery.error}
            organizationId={organizationId}
            reset={() => void afterQuery.refetch()}
          />
        </div>
      </ContentArea>
    );
  }

  // A failed read of the version compared with stays on screen while its
  // retry runs, rather than turning back into the loading state.
  const loading =
    afterQuery.isPending ||
    (fromVersion !== undefined && beforeQuery.isPending && !fromFailed);
  const message =
    after?.message === undefined || after.message.trim() === ''
      ? t('versions.noMessage')
      : after.message;
  const isLive = version === live;
  const back = live !== null && version < live;
  const options = compareOptions(
    (versionsQuery.data ?? []).map((entry) => entry.version),
    { to: version, live, basedOn: after?.basedOnVersion ?? null },
  ).map((option) => ({
    value: String(option.version),
    label:
      option.role === null
        ? t('versions.versionLabel', { version: option.version })
        : t(`compare.option.${option.role}`, { version: option.version }),
  }));
  const summary = diff === null ? null : changeSummaryOf(diff);

  // The items the box picked on the graph stands for: a node's own change,
  // Start's inputs, End's output.
  const boxItems =
    search.node === undefined ? [] : itemsOfBox(sections, search.node);

  const body = (() => {
    if (afterDoc === null) return null;
    if (fromMissing) {
      return (
        <Alert
          variant="warning"
          description={t(
            wasRemoved(fromVersion) ? 'compare.removed' : 'compare.missing',
            { version: fromVersion },
          )}
        />
      );
    }
    if (fromFailed) {
      return (
        <CatalogLoadError
          message={t('compare.fromFailed', { version: fromVersion })}
          failureKey={beforeRead.failureCount}
          isRetrying={beforeRead.retrying}
          onRetry={() => void beforeQuery.refetch()}
          onFocusLost={focusHeading}
        />
      );
    }
    if (diff === null) return null;
    if (diff.identical && fromVersion !== undefined) {
      return (
        <EmptyState
          icon={GitCompare}
          title={t('compare.identical.title', {
            from: fromVersion,
            to: version,
          })}
          {...(before?.message !== after?.message && {
            description: t('compare.identical.messageOnly'),
          })}
          headingLevel={3}
        />
      );
    }
    if (view === 'yaml') {
      return (
        <CodeDiff
          aria-label={
            fromVersion === undefined
              ? labels.after
              : t('compare.title', { from: fromVersion, to: version })
          }
          before={beforeDoc === null ? '' : yamlSource(beforeDoc)}
          after={yamlSource(afterDoc)}
          language="yaml"
          templates
          beforeLabel={labels.before}
          afterLabel={labels.after}
          layout={layout}
          onLayoutChange={setLayout}
        />
      );
    }
    if (view === 'changes') {
      return (
        <VersionChanges
          sections={sections}
          onShowOnGraph={(node) =>
            onSearchChange({ ...search, view: 'graph', node })
          }
        />
      );
    }
    return (
      <div className="@container/compare">
        <div className="flex flex-col gap-3 @4xl/compare:flex-row">
          <div className="h-[min(40rem,70dvh)] min-w-0 flex-1">
            <VersionGraph
              automationSlug={automationSlug}
              before={fromVersion === undefined ? null : beforeDoc}
              after={afterDoc}
              diff={diff}
              labels={labels}
              catalog={catalog}
              selectedId={search.node ?? null}
              onSelect={(node) => {
                const next: VersionCompareSearch = { ...search, view: 'graph' };
                if (node === null) delete next.node;
                else next.node = node;
                onSearchChange(next);
              }}
            />
          </div>
          {search.node !== undefined && (
            <aside
              aria-label={t('compare.panel.label')}
              className="flex shrink-0 flex-col gap-2 rounded-lg border p-3 @4xl/compare:w-[22rem]"
            >
              <div className="flex items-center justify-between gap-2">
                <Text variant="label">{t('compare.panel.label')}</Text>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  aria-label={t('compare.panel.close')}
                  onClick={() => {
                    const next = { ...search };
                    delete next.node;
                    onSearchChange(next);
                  }}
                />
              </div>
              {boxItems.length === 0 ? (
                <Text variant="muted">{t('compare.panel.unchanged')}</Text>
              ) : (
                <VersionChanges
                  note={false}
                  sections={sections.flatMap((section) => {
                    const items = section.items.filter((item) =>
                      boxItems.includes(item),
                    );
                    return items.length === 0
                      ? []
                      : [{ id: section.id, title: section.title, items }];
                  })}
                />
              )}
            </aside>
          )}
        </div>
      </div>
    );
  })();

  return (
    <ContentArea gap={6}>
      <Skeletonize loading={loading} label={t('compare.views.label')}>
        <StickySectionHeader
          as="h2"
          title={
            <span ref={headingRef} tabIndex={-1}>
              {`${labels.after} · ${message}`}
            </span>
          }
          description={
            after === null ? undefined : (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <VersionAuthor
                  organizationId={organizationId}
                  layout="inline"
                  facts={{
                    actor: after.createdBy,
                    via: after.createdVia ?? null,
                    viaInferred: after.viaInferred === true,
                    clientName: after.clientName ?? null,
                  }}
                />
                <span aria-hidden="true">·</span>
                <span>{formatDate(new Date(after.createdAt), 'long')}</span>
                {after.restoredFromVersion !== undefined &&
                  after.restoredFromVersion !== null && (
                    <Badge variant="slate" icon={RotateCcw}>
                      {t('versions.restores', {
                        version: after.restoredFromVersion,
                      })}
                    </Badge>
                  )}
                {isLive && (
                  <Badge variant="green" icon={Radio}>
                    {t('versions.deployed')}
                  </Badge>
                )}
              </span>
            )
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link
                  {...editorVersionLink({
                    organizationId,
                    automationSlug,
                    projectId,
                    version,
                  })}
                >
                  {t('versions.actions.openInEditor')}
                </Link>
              </Button>
              {canAuthor && latestKnown && !isLive && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={back ? Undo2 : Rocket}
                  aria-busy={deployer.pendingVersion === version || undefined}
                  onClick={() => deployer.deploy(version, live)}
                >
                  {back
                    ? t('deploy.rollBack', { version })
                    : t('detail.deployVersion', { version })}
                </Button>
              )}
              <EntityRowActions
                ariaLabel={t('compare.moreActions', { version })}
                actions={[
                  {
                    key: 'restore',
                    label: t('versions.actions.restore'),
                    icon: RotateCcw,
                    visible:
                      canAuthor && latest !== undefined && version !== latest,
                    onClick: () => setRestoring(version),
                  },
                  {
                    key: 'download',
                    label: t('versions.actions.downloadYaml'),
                    icon: Download,
                    onClick: () => download(version),
                  },
                ]}
              />
            </div>
          }
        />
        {latestRead.unavailable && (
          <CatalogLoadError
            message={t('detail.loadFailed.title')}
            failureKey={latestRead.failureCount}
            isRetrying={latestRead.retrying}
            onRetry={() => void latestQuery.refetch()}
            onFocusLost={focusHeading}
          />
        )}
        {after !== null &&
          actorLabel(after.createdBy).kind === 'unavailable' && (
            <AuthorNamesLoadError
              organizationId={organizationId}
              onFocusLost={focusHeading}
            />
          )}
        {triggerOff !== null && (
          <TriggerDeployNotice
            place={{ organizationId, projectId, name: automationSlug }}
            trigger={triggerOff}
          />
        )}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {options.length > 0 && (
              <Select
                label={t('compare.from.label')}
                value={
                  fromVersion === undefined ? undefined : String(fromVersion)
                }
                placeholder={t('compare.from.none')}
                options={options}
                onValueChange={(next) => {
                  const from = Number(next);
                  if (Number.isInteger(from) && from > 0) {
                    onSearchChange({ ...search, from });
                  }
                }}
                wrapperClassName="w-60"
              />
            )}
            {summary !== null &&
              fromVersion !== undefined &&
              summary.identical !== true && (
                <ChangeSummary
                  variant="chips"
                  aria-label={t('compare.summary.label')}
                  counts={{
                    added: summary.nodes.added,
                    removed: summary.nodes.removed,
                    changed: summary.nodes.changed,
                    renamed: summary.nodes.renamed ?? 0,
                  }}
                  flags={changeFlags(summary, t)}
                />
              )}
          </div>
          {fromVersion === undefined && (
            <Alert
              variant="info"
              description={t('compare.firstVersion', { version })}
            />
          )}
          <h3 className="sr-only">
            {fromVersion === undefined
              ? labels.after
              : t('compare.title', { from: fromVersion, to: version })}
          </h3>
          <SegmentedControl
            aria-label={t('compare.views.label')}
            value={view}
            onValueChange={(next) => {
              if (isView(next)) onSearchChange({ ...search, view: next });
            }}
            options={[
              { value: 'graph', label: t('compare.views.graph') },
              { value: 'changes', label: t('compare.views.changes') },
              { value: 'yaml', label: t('compare.views.yaml') },
            ]}
            className="self-start"
          />
          {body}
        </div>
      </Skeletonize>
      <DeployRefusedDialog
        organizationId={organizationId}
        automationSlug={automationSlug}
        projectId={projectId}
        refusal={deployer.refusal}
        onClose={deployer.closeRefusal}
      />
      {latest !== undefined && (
        <RestoreVersionDialog
          organizationId={organizationId}
          automationSlug={automationSlug}
          projectId={projectId}
          version={restoring}
          latestVersion={latest}
          liveVersion={live}
          canDeploy={canAuthor}
          deployer={deployer}
          onClose={() => setRestoring(null)}
        />
      )}
    </ContentArea>
  );
}
