'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Dialog } from '@tale/ui/dialog/dialog';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import {
  EditorActions,
  EditorSaveCancelledError,
  useActiveEditor,
  useRegisterActiveEditor,
  useRegisterDirtySource,
  type EditorController,
} from '@tale/ui/editor';
import { EmptyState } from '@tale/ui/empty-state';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { PageActionHeader } from '@tale/ui/page-action-header';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Play,
  Rocket,
  SearchX,
  Zap,
} from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { NodeDef, Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import {
  useDeployAutomation,
  useSaveAutomation,
  useStartAutomationRun,
} from '../hooks/mutations';
import {
  useAutomation,
  useAutomationProjects,
  useAutomationRuns,
  useAutomationVersions,
  useNodeTypeCatalog,
} from '../hooks/queries';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { automationDetailPathname } from '../lib/detail-paths';
import { readDocument, readPositions } from '../lib/document';
import { automationErrorMessage, isMissingAutomationRead } from '../lib/errors';
import { buildGraph } from '../lib/graph';
import { nodeStatusMap, projectRun } from '../lib/run-view';
import {
  AUTOMATION_EDITOR_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
} from '../lib/workbench';
import { AutomationCanvas } from './automation-canvas';
import {
  AutomationRunDialog,
  type AutomationRunRequest,
} from './automation-run-dialog';
import { NodeInspector } from './node-inspector';
import { WorkflowSettings } from './workflow-settings';

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
  'modelProvider',
  'outputSchema',
  'automation',
  // Agent equipment — clearing a picker to empty must delete the field, not
  // leave the previous grant behind (and `readNode` now round-trips these).
  'harness',
  'skills',
  'connectors',
  'tools',
  'secrets',
  'files',
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
 * the one cluster on screen: the automation detail shell mounts a provider
 * around every tab and renders no cluster of its own, so exactly one — this
 * one, portaled into the tab strip — is ever on screen.
 */
function AutomationEditorActions() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="automation" />;
}

interface AutomationEditorProps {
  organizationId: string;
  automationSlug: string;
  /** Render inside a project shell: run links stay on the project routes and
   * a first save pins the automation to the project. */
  projectId?: string;
  /** The stored version on the canvas; absent means the latest. */
  version?: number;
  /** The author picked a version to look at — `undefined` asks for the latest
   * again (after a save appends one). */
  onSelectVersion: (version: number | undefined) => void;
}

/** Route parameters can change without unmounting the page. Keep the draft
 * and inspector state with one automation in one scope — the version on the
 * canvas is the route's search, so it already belongs to the new URL — while
 * the shared dirty guard still confirms navigation before these props change. */
export function AutomationEditor(props: AutomationEditorProps) {
  return (
    <AutomationEditorScope
      key={JSON.stringify([
        props.organizationId,
        props.automationSlug,
        props.projectId ?? null,
      ])}
      {...props}
    />
  );
}

/**
 * The Editor tab: one automation's document on the canvas beside its node
 * inspector, with the trigger and project bindings in the panel until a node
 * is selected. The version history and the run log are their own tabs.
 *
 * The canvas always shows a stored VERSION — versions are immutable, so what
 * is drawn is exactly what was saved and exactly what a run of that version
 * will do. Which one is the route's `version` (the URL's `?version=`, absent
 * for the latest); switching is reported through `onSelectVersion`, so a
 * Versions row, a shared link and the picker here all land on the same
 * picture. Editing builds a draft in the browser; saving appends a NEW
 * version rather than changing the one on screen, which is what keeps a live
 * automation from changing under a run already in flight.
 *
 * The most recent run is laid over the canvas by default, because the first
 * question anyone opening an automation has is "did the last one work".
 */
function AutomationEditorScope({
  organizationId,
  automationSlug,
  projectId,
  version,
  onSelectVersion,
}: AutomationEditorProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const inspectorId = useId();
  const saveMessageId = useId();
  const ability = useAbility();
  // Mirrors the backend split: reads and mock runs are member acts, while
  // saving, deploying, triggering, and LIVE runs demand the
  // `developerSettings` ability — hiding what would only fail server-side.
  const canAuthor = ability.can('read', 'developerSettings');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const deselectNode = useCallback(() => {
    const id = selectedNodeId;
    setSelectedNodeId(null);
    if (id !== null) {
      queueMicrotask(() => {
        focusAutomationNode(id);
      });
    }
  }, [selectedNodeId]);
  const [draft, setDraft] = useState<Automation | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  /** A refused RUN, not refused save feedback — see the Alert below. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** A refused DEPLOY from the looking-vs-live control — the only deploy
   * control there is; the Versions tab's rows never deploy. */
  const [deployRefusal, setDeployRefusal] = useState<string | null>(null);
  const [showLastRun, setShowLastRun] = useState(true);
  const [runRequest, setRunRequest] = useState<AutomationRunRequest | null>(
    null,
  );
  /** Which project a manual run operates in — `undefined` means org-wide, the
   * default. Only offered (and only meaningful) when the automation is bound to
   * more than one project; a sole binding is auto-applied server-side, and an
   * org-level automation is org-wide already. */
  const [runProjectId, setRunProjectId] = useState<string | undefined>(
    undefined,
  );
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  /** The version the author asked to switch to while holding a draft. */
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);

  const automationQuery = useAutomation(
    organizationId,
    automationSlug,
    version,
  );
  const deployedQuery = useAutomation(
    organizationId,
    automationSlug,
    automationQuery.data?.deployedVersion,
  );
  const versionsQuery = useAutomationVersions(organizationId, automationSlug);
  // Only the newest run matters here — it is what the canvas overlays; the
  // Runs tab reads the log.
  const runsQuery = useAutomationRuns(organizationId, automationSlug, 1);
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const boundProjectIds = useAutomationProjects(organizationId, automationSlug);
  const { projects } = useProjects(organizationId);
  const save = useSaveAutomation();
  const startRun = useStartAutomationRun();
  const deploy = useDeployAutomation();

  // The projects a run may target: the automation's own bindings, resolved to
  // names. A run scope only needs choosing when there are two or more — one
  // binding is auto-applied server-side, none means org-wide.
  const boundProjects = useMemo(() => {
    const ids = new Set((boundProjectIds.data ?? []).map(String));
    return projects.filter((project) => ids.has(project._id));
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

  // Where a LIVE run will act, always stated in its confirm dialog so a live
  // run is never ambiguous. A sole binding has no picker — the server pins it —
  // but it is named here all the same; a multi-bound run echoes the picker's
  // choice; an org-level automation says so.
  const soleBoundProject =
    boundProjects.length === 1 ? boundProjects[0] : undefined;
  const liveRunScopeText =
    soleBoundProject !== undefined
      ? t('detail.runScope.confirmProject', { project: soleBoundProject.name })
      : runProjectName !== undefined
        ? t('detail.runScope.confirmProject', { project: runProjectName })
        : t('detail.runScope.confirmOrgWide');

  const stored = useMemo(
    () => readDocument(automationQuery.data?.document),
    [automationQuery.data?.document],
  );
  const deployed = useMemo(
    () => readDocument(deployedQuery.data?.document),
    [deployedQuery.data?.document],
  );
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
  const requestVersionSwitch = (next: number): void => {
    // Another version replaces what the canvas shows, so a draft cannot
    // survive the switch — ask before dropping it.
    if (isDirty) {
      setPendingVersion(next);
      return;
    }
    onSelectVersion(next);
  };
  const versionEntries = useMemo(
    () => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version),
    [versionsQuery.data],
  );

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
  // A draft lives in this component only, so leaving the tab loses it —
  // every navigation away is worth a prompt. Scoped to the editor's own path:
  // a version switch is a search-param change on this same page, and it has
  // its own confirm above, so the blocker must not ask a second time.
  // Members never accumulate a draft: the inspector is read-only without the
  // developer capability.
  useRegisterDirtySource(isDirty, {
    scopePath: `${automationDetailPathname({
      organizationId,
      automationSlug,
      ...(projectId !== undefined && { projectId }),
    })}/editor`,
  });

  // The shell already answers an unknown slug; this catches a `?version=`
  // that no longer exists (the route answers 404 for that too).
  if (isMissingAutomationRead(automationQuery)) {
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
  const scheduleRun = (
    request: AutomationRunRequest,
    input?: unknown,
  ): void => {
    setRefusal(null);
    setRunRequest(null);
    startRun.mutate(
      {
        organizationId,
        name: automationSlug,
        mode: request.mode,
        version: request.version,
        ...(request.schema !== undefined && { input }),
        ...(request.projectId !== undefined && {
          projectId: request.projectId,
        }),
      },
      { onError: (error) => setRefusal(automationErrorMessage(error)) },
    );
  };

  const lookingVersion = meta?.version;
  const lookingIsLive =
    lookingVersion !== undefined && lookingVersion === meta?.deployedVersion;
  const versionMenuItems: DropdownMenuGroup[] =
    lookingVersion === undefined || versionEntries.length === 0
      ? []
      : [
          versionEntries.map((entry) => {
            const isDeployed = entry.version === meta?.deployedVersion;
            return {
              type: 'item' as const,
              label: t('versions.versionLabel', { version: entry.version }),
              selected: entry.version === lookingVersion,
              trailing: isDeployed ? t('versions.deployed') : undefined,
              onClick: () => {
                if (entry.version !== lookingVersion) {
                  requestVersionSwitch(entry.version);
                }
              },
            };
          }),
        ];
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
      // The save appended a version; show it, whichever one was on screen.
      onSelectVersion(undefined);
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
        // Display name is the breadcrumb h1 in AdaptiveHeader. Live sits
        // next to that name when the canvas version is the live one. The
        // version switcher and the run/save verbs portal into the tab
        // strip's trailing slot — where every tabbed page keeps its
        // Save/Discard. Pack descriptions stay off this workbench — they
        // belong on list/catalog surfaces where you pick an automation.
        {...(lookingIsLive && {
          identity: (
            <Badge variant="green" icon={CheckCircle2}>
              {t('versions.deployed')}
            </Badge>
          ),
        })}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lookingVersion !== undefined && versionMenuItems.length > 0 && (
              <DropdownMenu
                align="end"
                items={versionMenuItems}
                trigger={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={t('detail.versionSelect')}
                    aria-haspopup="menu"
                    className="gap-1.5"
                  >
                    {t('versions.versionLabel', {
                      version: lookingVersion,
                    })}
                    <ChevronDown aria-hidden className="size-3.5 shrink-0" />
                  </Button>
                }
              />
            )}
            {canAuthor && lookingVersion !== undefined && !lookingIsLive && (
              <Button
                variant="secondary"
                size="sm"
                icon={Rocket}
                isLoading={deploy.isPending}
                onClick={() => {
                  setDeployRefusal(null);
                  deploy.mutate(
                    {
                      organizationId,
                      name: automationSlug,
                      version: lookingVersion,
                    },
                    {
                      onError: (error) => {
                        setDeployRefusal(automationErrorMessage(error));
                      },
                    },
                  );
                }}
              >
                {t('detail.deployThis')}
              </Button>
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
                    value: project._id,
                    label: project.name,
                  })),
                ]}
                value={
                  effectiveRunProjectId === undefined
                    ? RUN_SCOPE_ORG_WIDE
                    : effectiveRunProjectId
                }
                onValueChange={(value) => {
                  // Radix fires a spurious '' on unmount — never act on it.
                  if (value === '') return;
                  setRunProjectId(
                    value === RUN_SCOPE_ORG_WIDE
                      ? undefined
                      : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- value is one of the bound project ids above
                        value,
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
                if (meta == null || stored === null) return;
                const request: AutomationRunRequest = {
                  mode: 'mock',
                  version: meta.version,
                  ...(stored.inputs !== undefined && { schema: stored.inputs }),
                  ...(effectiveRunProjectId !== undefined && {
                    projectId: effectiveRunProjectId,
                  }),
                  scopeText: liveRunScopeText,
                };
                if (request.schema === undefined) scheduleRun(request);
                else setRunRequest(request);
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
                disabled={
                  meta?.deployedVersion === undefined ||
                  deployedQuery.isPending ||
                  deployed === null
                }
                disabledReason={t('detail.runLiveNeedsDeploy')}
                onClick={() => {
                  if (meta?.deployedVersion === undefined || deployed === null)
                    return;
                  setRunRequest({
                    mode: 'live',
                    version: meta.deployedVersion,
                    ...(deployed.inputs !== undefined && {
                      schema: deployed.inputs,
                    }),
                    ...(effectiveRunProjectId !== undefined && {
                      projectId: effectiveRunProjectId,
                    }),
                    scopeText: liveRunScopeText,
                  });
                }}
              >
                {t('detail.runLive')}
              </Button>
            )}
            {canAuthor && <AutomationEditorActions />}
          </div>
        }
      />
      {/* Full width rather than the `narrow` configuration measure: this tab is
          a workbench, not a form — the canvas and its inspector are a
          two-column grid, and constraining them to the settings measure would
          stack everything into one 48rem column and make the graph
          unreadable. `min-h-0 flex-1` hands the grid the height the header
          and tab strip leave, so the workbench fills the window. */}
      <ContentArea className="min-h-0 flex-1" gap={4}>
        {/* A refused RUN, kept inline: it is the engine's own account of why
            nothing started, which the author has to read next to the automation
            it concerns. Save feedback goes through the editor cluster instead. */}
        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}
        {deployRefusal !== null && (
          <Alert
            variant="destructive"
            title={t('versions.deployRefused')}
            description={deployRefusal}
          />
        )}

        <div className={AUTOMATION_EDITOR_WORKBENCH_GRID}>
          <div className={AUTOMATION_WORKBENCH_CANVAS_SLOT}>
            {lastRun ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-2">
                <Button
                  variant="secondary"
                  size="icon"
                  className="pointer-events-auto"
                  aria-pressed={showLastRun}
                  title={
                    showLastRun
                      ? t('detail.hideLastRun')
                      : t('detail.showLastRun')
                  }
                  tooltipSide="left"
                  onClick={() => {
                    setShowLastRun((shown) => !shown);
                  }}
                >
                  {showLastRun ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            ) : null}
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
            onDeselect={deselectNode}
            workflow={
              <WorkflowSettings
                organizationId={organizationId}
                name={automationSlug}
                canEdit={canAuthor}
              />
            }
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

      {runRequest !== null && (
        <AutomationRunDialog
          request={runRequest}
          onClose={() => setRunRequest(null)}
          onConfirm={(input) => scheduleRun(runRequest, input)}
        />
      )}

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
          if (pendingVersion !== null) onSelectVersion(pendingVersion);
          setPendingVersion(null);
        }}
      />
    </>
  );
}
