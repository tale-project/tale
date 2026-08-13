'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Play, SearchX, Save, Zap } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { PageActionHeader } from '@/app/components/layout/page-action-header';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import {
  EditorActions,
  EditorSaveCancelledError,
  useActiveEditor,
  useRegisterActiveEditor,
  useRegisterDirtySource,
  type EditorController,
} from '@/app/components/ui/editor';
import { Select } from '@/app/components/ui/forms/select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import type { NodeDef, Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { automationDisplayDescription } from '@/lib/shared/schemas/automation_presentation';

import { mergeNodeTypes } from '../hooks/backend';
import { useSaveAutomation, useStartAutomationRun } from '../hooks/mutations';
import {
  useAutomation,
  useAutomationProjects,
  useAutomationRuns,
  useAutomationVersions,
  useNodeTypeCatalog,
} from '../hooks/queries';
import { readDocument, readPositions } from '../lib/document';
import { automationErrorMessage } from '../lib/errors';
import { buildGraph } from '../lib/graph';
import { nodeStatusMap, projectRun } from '../lib/run-view';
import { AutomationCanvas } from './automation-canvas';
import { NodeInspector } from './node-inspector';
import { ProjectBindingsSection } from './project-bindings-section';
import { RunList } from './run-list';
import { TriggerEditor } from './trigger-editor';
import { VersionList } from './version-list';

/**
 * Every field of a node a patch may clear. Spelling them out keeps the unset
 * path typed — `delete` needs a key the compiler knows is optional — and the
 * list is checked against `NodeDef` itself, so a field added to the document
 * grammar cannot silently become unclearable.
 */
const CLEARABLE_NODE_FIELDS = [
  'when',
  'elseOf',
  'forEach',
  'repeatUntil',
  'maxRepeats',
  'onError',
  'input',
  'code',
  'prompt',
  'system',
  'model',
  'outputSchema',
  'automation',
] as const satisfies readonly Exclude<keyof NodeDef, 'id' | 'type'>[];

/** The run-scope Select's "organization-wide" choice. A Radix Select item
 * cannot carry an empty value, so the org-wide option needs a real sentinel
 * that maps back to an omitted `projectId`. */
const RUN_SCOPE_ORG_WIDE = '__org_wide__';

/** Apply one node patch to a document, dropping the fields the patch clears. */
function patchNode(
  automation: Automation,
  nodeId: string,
  patch: Partial<NodeDef>,
): Automation {
  return {
    ...automation,
    nodes: automation.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const next: NodeDef = { ...node, ...patch };
      for (const field of CLEARABLE_NODE_FIELDS) {
        // `undefined` in a patch means "unset": a cleared `when` must leave the
        // document, not sit in it as an empty condition the engine would read.
        if (field in patch && patch[field] === undefined) delete next[field];
      }
      return next;
    }),
  };
}

const NO_DIRTY_KEYS: ReadonlySet<string> = new Set();
/** A draft diverges from the stored version as one thing — its document. */
const DOCUMENT_DIRTY_KEYS: ReadonlySet<string> = new Set(['document']);

/**
 * The page's Save/Discard cluster.
 *
 * It reads the ACTIVE editor from the shell's registry instead of taking the
 * controller as a prop, so the shell that mounts `ActiveEditorProvider` owns
 * the one cluster on screen: the org area layout and the project-scoped
 * automation route each mount a provider around this page and render no cluster
 * of their own, and a shell that does render one (a tab strip) registers above
 * this provider, so two can never appear at once.
 */
function AutomationEditorActions() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="automation" />;
}

/**
 * One automation: its document on the canvas, its history, and its runs.
 *
 * The page always shows a stored VERSION — versions are immutable, so what is
 * drawn is exactly what was saved and exactly what a run of that version will
 * do. Editing builds a draft in the browser; saving appends a NEW version
 * rather than changing the one on screen, which is what keeps a live automation
 * from changing under a run already in flight.
 *
 * The most recent run is laid over the canvas by default, because the first
 * question anyone opening an automation has is "did the last one work".
 */
export function AutomationDetail({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Render inside a project shell: run links stay on the project routes and
   * a first save pins the automation to the project. */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const inspectorId = useId();
  const saveMessageId = useId();
  const ability = useAbility();
  // Mirrors the backend split: reads and mock runs are member acts, while
  // saving, deploying, triggering, and LIVE runs demand
  // `requireOrgAdminOrDeveloper` — hiding what would only fail server-side.
  const canAuthor = ability.can('read', 'developerSettings');
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(
    undefined,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Automation | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  /** A refused RUN, not refused save feedback — see the Alert below. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showLastRun, setShowLastRun] = useState(true);
  const [confirmLiveRun, setConfirmLiveRun] = useState(false);
  /** Which project a manual run operates in — `undefined` means org-wide, the
   * default. Only offered (and only meaningful) when the automation is bound to
   * more than one project; a sole binding is auto-applied server-side, and an
   * org-level automation is org-wide already. */
  const [runProjectId, setRunProjectId] = useState<Id<'projects'> | undefined>(
    undefined,
  );
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  /** The version the author asked to switch to while holding a draft. */
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);

  const automationQuery = useAutomation(
    organizationId,
    automationSlug,
    selectedVersion,
  );
  const versionsQuery = useAutomationVersions(organizationId, automationSlug);
  const runsQuery = useAutomationRuns(organizationId, automationSlug, 20);
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const boundProjectIds = useAutomationProjects(organizationId, automationSlug);
  const { projects } = useProjects(organizationId);
  const save = useSaveAutomation();
  const startRun = useStartAutomationRun();

  // The projects a run may target: the automation's own bindings, resolved to
  // names. A run scope only needs choosing when there are two or more — one
  // binding is auto-applied server-side, none means org-wide.
  const boundProjects = useMemo(() => {
    const ids = new Set((boundProjectIds.data ?? []).map(String));
    return projects.filter((project) => ids.has(String(project._id)));
  }, [boundProjectIds.data, projects]);
  const canChooseRunProject = boundProjects.length >= 2;

  // What actually rides on the run: the chosen project, but only while it is
  // still a valid, offered binding. A binding removed after selection, or a
  // stale choice on an automation that is no longer multi-bound, falls back to
  // org-wide rather than starting a refused run.
  const effectiveRunProjectId = useMemo(() => {
    if (!canChooseRunProject || runProjectId === undefined) return undefined;
    return boundProjects.some((project) => project._id === runProjectId)
      ? runProjectId
      : undefined;
  }, [canChooseRunProject, runProjectId, boundProjects]);
  const runProjectName =
    effectiveRunProjectId === undefined
      ? undefined
      : boundProjects.find((project) => project._id === effectiveRunProjectId)
          ?.name;

  const stored = useMemo(
    () => readDocument(automationQuery.data?.document),
    [automationQuery.data?.document],
  );
  const { locale } = useLocale();
  const automation = draft ?? stored;
  const graph = useMemo(() => buildGraph(automation), [automation]);
  const positions = useMemo(() => readPositions(automation), [automation]);

  const runs = runsQuery.data ?? [];
  const lastRun = runs[0];
  const lastRunProjection = useMemo(
    () => projectRun(showLastRun ? lastRun : null),
    [showLastRun, lastRun],
  );
  const runStatusByNode = useMemo(
    () =>
      showLastRun && lastRun
        ? nodeStatusMap(
            lastRunProjection,
            graph.nodes.map((node) => node.id),
          )
        : undefined,
    [showLastRun, lastRun, lastRunProjection, graph.nodes],
  );

  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data),
    [catalogQuery.data],
  );

  const onChangeNode = useCallback(
    (patch: Partial<NodeDef>) => {
      if (!automation || selectedNodeId === null) return;
      setDraft(patchNode(automation, selectedNodeId, patch));
    },
    [automation, selectedNodeId],
  );

  const isDirty = draft !== null;

  // The save-version dialog settles the promise `save()` handed back: confirming
  // resolves it once the version is written, backing out rejects it as a
  // cancellation, and a refused write rejects it with the store's own sentence.
  const pendingSaveRef = useRef<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null>(null);

  const requestSave = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (pendingSaveRef.current !== null) {
          // The dialog is already up and owns this save; a second request
          // (⌘S while it is open) is a deliberate no-op.
          reject(new EditorSaveCancelledError());
          return;
        }
        pendingSaveRef.current = { resolve, reject };
        setSaveDialogOpen(true);
      }),
    [],
  );

  const cancelSave = useCallback(() => {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    setSaveDialogOpen(false);
    // Backing out is not a failure: the cluster stays silent and the draft
    // stays dirty so the author can try again.
    pending?.reject(new EditorSaveCancelledError());
  }, []);

  const discardDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const controller = useMemo<EditorController>(
    () => ({
      isDirty,
      isSaving: save.isPending,
      // Nothing about a draft document can be judged in the browser — the
      // store owns the naming rules and the schema — so a draft is always
      // savable and the refusal, when there is one, comes from the server.
      isValid: true,
      isLoading: automationQuery.isPending,
      dirtyKeys: isDirty ? DOCUMENT_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: requestSave,
      reset: discardDraft,
    }),
    [
      isDirty,
      save.isPending,
      automationQuery.isPending,
      requestSave,
      discardDraft,
    ],
  );

  useRegisterActiveEditor(controller);
  // A draft lives in this component only, so leaving the page loses it —
  // every navigation away is worth a prompt. Members never accumulate one:
  // the inspector is read-only without the developer capability.
  useRegisterDirtySource(isDirty);

  if (automationQuery.data === null) {
    return (
      <ContentArea variant="narrow">
        <EmptyState
          icon={SearchX}
          title={t('notFound.title')}
          description={t('notFound.description')}
          headingLevel={2}
        />
      </ContentArea>
    );
  }
  if (!automation) {
    return (
      <ContentArea variant="narrow">
        <Text as="p" variant="muted" className="text-sm">
          {t('detail.loading')}
        </Text>
      </ContentArea>
    );
  }

  const meta = automationQuery.data;
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const confirmSave = async (): Promise<void> => {
    const pending = pendingSaveRef.current;
    try {
      await save.mutateAsync({
        organizationId,
        automation,
        ...(saveMessage !== '' && { message: saveMessage }),
        // Binds a NEW automation to this project on its first save; an
        // existing one keeps its bindings (membership is managed in the
        // Projects panel, never moved by saving a version).
        ...(projectId !== undefined && { projectId }),
      });
      pendingSaveRef.current = null;
      setSaveDialogOpen(false);
      setDraft(null);
      setSaveMessage('');
      setSelectedVersion(undefined);
      pending?.resolve();
    } catch (error) {
      pendingSaveRef.current = null;
      setSaveDialogOpen(false);
      // The store's refusal names the problem AND the fix; hand that sentence
      // to the Save cluster, which owns the single failure toast.
      pending?.reject(new Error(automationErrorMessage(error)));
    }
  };

  return (
    <>
      <PageActionHeader
        // The automation's display name is the area header's `h1` leaf
        // (`AutomationBreadcrumbs`); this strip carries the description and
        // the run / save actions only.
        {...(() => {
          // The manifest's own description in the reader's language when the
          // pack declared one; the document's otherwise.
          const described =
            automationDisplayDescription(
              automationQuery.data?.presentation,
              locale,
            ) ?? automation.description;
          return described !== undefined ? { description: described } : {};
        })()}
        // Which version is on screen, and which one is live, belong beside the
        // actions rather than inside the heading — a badge is status, not title.
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {meta && (
              <Badge variant="slate">
                {t('versions.versionLabel', { version: meta.version })}
              </Badge>
            )}
            {meta?.deployedVersion !== undefined && (
              <Badge variant="green" icon={CheckCircle2}>
                {t('detail.deployedVersion', { version: meta.deployedVersion })}
              </Badge>
            )}
            {canChooseRunProject && (
              <Select
                aria-label={t('detail.runScope.label')}
                className="w-48"
                options={[
                  {
                    value: RUN_SCOPE_ORG_WIDE,
                    label: t('detail.runScope.orgWide'),
                  },
                  ...boundProjects.map((project) => ({
                    value: String(project._id),
                    label: project.name,
                  })),
                ]}
                value={
                  effectiveRunProjectId === undefined
                    ? RUN_SCOPE_ORG_WIDE
                    : String(effectiveRunProjectId)
                }
                onValueChange={(value) => {
                  // Radix fires a spurious '' on unmount — never act on it.
                  if (value === '') return;
                  setRunProjectId(
                    value === RUN_SCOPE_ORG_WIDE
                      ? undefined
                      : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- value is one of the bound project ids above
                        (value as Id<'projects'>),
                  );
                }}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={Play}
              isLoading={startRun.isPending}
              onClick={() => {
                setRefusal(null);
                startRun.mutate(
                  {
                    organizationId,
                    name: automationSlug,
                    mode: 'mock',
                    // A test run exercises the version on screen — the badge
                    // beside this button — so an undeployed draft is testable.
                    // Without a version the server falls back to the deployed
                    // one and refuses when there is none.
                    ...(meta && { version: meta.version }),
                    ...(effectiveRunProjectId !== undefined && {
                      projectId: effectiveRunProjectId,
                    }),
                  },
                  {
                    onError: (error) => {
                      setRefusal(automationErrorMessage(error));
                    },
                  },
                );
              }}
            >
              {t('detail.runMock')}
            </Button>
            {canAuthor && (
              <Button
                variant="secondary"
                size="sm"
                icon={Zap}
                isLoading={startRun.isPending}
                disabled={meta?.deployedVersion === undefined}
                disabledReason={t('detail.runLiveNeedsDeploy')}
                onClick={() => {
                  setConfirmLiveRun(true);
                }}
              >
                {t('detail.runLive')}
              </Button>
            )}
            {canAuthor && <AutomationEditorActions />}
          </div>
        }
      />
      {/* Full width rather than the `narrow` configuration measure: this page is
          a workbench, not a form — the canvas and its inspector are a
          two-column grid, and the version and run logs read as a pair beside
          it. Constraining them to the settings measure would stack everything
          into one 48rem column and make the graph unreadable. */}
      <ContentArea className="flex-1" gap={4}>
        {/* A refused RUN, kept inline: it is the engine's own account of why
            nothing started, which the author has to read next to the automation
            it concerns. Save feedback goes through the editor cluster instead. */}
        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        {lastRun && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={showLastRun}
              onClick={() => {
                setShowLastRun((shown) => !shown);
              }}
            >
              {showLastRun ? t('detail.hideLastRun') : t('detail.showLastRun')}
            </Button>
            {projectId ? (
              <Link
                to="/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId"
                params={{
                  id: organizationId,
                  projectId,
                  automationSlug: automationSlugToParam(automationSlug),
                  runId: lastRun.id,
                }}
                className="focus-visible:ring-ring text-sm underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t('detail.openLastRun')}
              </Link>
            ) : (
              <Link
                to="/dashboard/$id/automations/$automationSlug/runs/$runId"
                params={{
                  id: organizationId,
                  automationSlug: automationSlugToParam(automationSlug),
                  runId: lastRun.id,
                }}
                className="focus-visible:ring-ring text-sm underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t('detail.openLastRun')}
              </Link>
            )}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-[26rem] flex-col">
            <AutomationCanvas
              graph={graph}
              positions={positions}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              inspectorId={inspectorId}
              {...(runStatusByNode !== undefined && { runStatusByNode })}
            />
          </div>
          <NodeInspector
            id={inspectorId}
            node={selectedNode}
            nodeType={nodeTypes.find((def) => def.type === selectedNode?.type)}
            catalogUnavailable={catalogQuery.isError}
            runView={
              selectedNode && showLastRun
                ? lastRunProjection.byNode.get(selectedNode.id)
                : undefined
            }
            readOnly={!canAuthor}
            onChange={onChangeNode}
            organizationId={organizationId}
            {...(projectId !== undefined && { projectId })}
          />
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <TriggerEditor
            organizationId={organizationId}
            name={automationSlug}
            canEdit={canAuthor}
          />

          <ProjectBindingsSection
            organizationId={organizationId}
            name={automationSlug}
            canEdit={canAuthor}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <VersionList
            organizationId={organizationId}
            name={automationSlug}
            versions={versionsQuery.data ?? []}
            deployedVersion={meta?.deployedVersion}
            canDeploy={canAuthor}
            selectedVersion={selectedVersion ?? meta?.version}
            onSelectVersion={(version) => {
              // Another version replaces what the canvas shows, so a draft
              // cannot survive the switch — ask before dropping it.
              if (isDirty) {
                setPendingVersion(version);
                return;
              }
              setSelectedVersion(version);
            }}
          />
          <RunList
            organizationId={organizationId}
            automationSlug={automationSlug}
            runs={runs}
            {...(projectId !== undefined && { projectId })}
          />
        </div>
      </ContentArea>

      {/* Saving APPENDS a version, so the one thing the author is asked for is
          the line that will stand in the history beside it. */}
      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          // A write in flight cannot be backed out of — Escape and the close
          // control wait for it, exactly as the Cancel button does.
          if (!open && !save.isPending) cancelSave();
        }}
        title={t('detail.saveDialog.title')}
        description={t('detail.saveDialog.description')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={cancelSave}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="button"
              icon={Save}
              isLoading={save.isPending}
              onClick={() => void confirmSave()}
            >
              {t('detail.saveVersion')}
            </Button>
          </>
        }
      >
        <Field
          label={t('detail.saveMessageLabel')}
          htmlFor={saveMessageId}
          description={t('detail.saveMessageDescription')}
        >
          <Input
            id={saveMessageId}
            value={saveMessage}
            onChange={(event) => {
              setSaveMessage(event.target.value);
            }}
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={confirmLiveRun}
        onOpenChange={setConfirmLiveRun}
        title={t('detail.runLiveTitle')}
        description={t('detail.runLiveBody')}
        confirmText={t('detail.runLive')}
        onConfirm={() => {
          setRefusal(null);
          // Close before the mutation settles: startRun only schedules the
          // run — a later LIVE_BODY_FAILED is a run outcome, not a start
          // refusal, so waiting on it would leave this dialog stuck open.
          setConfirmLiveRun(false);
          startRun.mutate(
            {
              organizationId,
              name: automationSlug,
              mode: 'live',
              ...(effectiveRunProjectId !== undefined && {
                projectId: effectiveRunProjectId,
              }),
            },
            {
              onError: (error) => {
                setRefusal(automationErrorMessage(error));
              },
            },
          );
        }}
      >
        {/* Name the scope on the consequential run: a bound project it acts in,
            or the organization-wide default. */}
        {canChooseRunProject && (
          <Text as="p" variant="muted" className="text-sm">
            {runProjectName === undefined
              ? t('detail.runScope.confirmOrgWide')
              : t('detail.runScope.confirmProject', {
                  project: runProjectName,
                })}
          </Text>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingVersion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVersion(null);
        }}
        title={t('detail.switchVersion.title')}
        description={t('detail.switchVersion.description')}
        confirmText={t('detail.switchVersion.confirm')}
        variant="destructive"
        onConfirm={() => {
          setDraft(null);
          setSelectedVersion(pendingVersion ?? undefined);
          setPendingVersion(null);
        }}
      />
    </>
  );
}
