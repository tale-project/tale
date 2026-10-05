'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Dialog } from '@tale/ui/dialog/dialog';
import {
  EditorSaveCancelledError,
  useRegisterActiveEditor,
  useRegisterDirtySource,
  type EditorController,
} from '@tale/ui/editor';
import { EmptyState } from '@tale/ui/empty-state';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { PageActionHeader } from '@tale/ui/page-action-header';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { useToast } from '@tale/ui/use-toast';
import {
  CheckCircle2,
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
import { readStateOf } from '@/app/lib/backend/read-state';
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
  useNodeTypeCatalog,
} from '../hooks/queries';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { automationDetailPathname } from '../lib/detail-paths';
import { DOCUMENT_DIRTY_KEY } from '../lib/dirty-keys';
import { readDocument, readPositions } from '../lib/document';
import {
  automationErrorCode,
  automationErrorLatestVersion,
  automationErrorMessage,
  isMissingAutomationRead,
} from '../lib/errors';
import { buildGraph } from '../lib/graph';
import { nodeStatusMap, projectRun, readRunCursorNode } from '../lib/run-view';
import {
  AUTOMATION_EDITOR_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_WORKBENCH_COMPACT_QUERY,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from '../lib/workbench';
import { AutomationCanvas } from './automation-canvas';
import { AutomationEditorActions } from './automation-editor-actions';
import {
  AutomationRunDialog,
  type AutomationRunRequest,
} from './automation-run-dialog';
import { AutomationVersionPicker } from './automation-version-picker';
import { NodeFields, NodeInspector } from './node-inspector';

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
const DOCUMENT_DIRTY_KEYS: ReadonlySet<string> = new Set([DOCUMENT_DIRTY_KEY]);

interface AutomationEditorProps {
  organizationId: string;
  automationSlug: string;
  /** Render inside a project shell: run links stay on the project routes and
   * a first save pins the automation to the project. */
  projectId?: string;
  /** The stored version on the canvas; absent means the latest. */
  version?: number;
  showVersionHistory?: boolean;
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
 * inspector. The automation's own settings (trigger, project bindings) are
 * the General tab; version history opens from the tab strip and the run log
 * has its own tab.
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
  showVersionHistory,
  onSelectVersion,
}: AutomationEditorProps) {
  const { t } = useT('automations');
  const isMobile = useIsMobile();
  // Whether there's a side panel to put a picked node's fields in — below
  // it, they open in a sheet over the canvas instead (see the constant).
  const isWorkbenchCompact = useMediaQuery(AUTOMATION_WORKBENCH_COMPACT_QUERY);
  const { toast } = useToast();
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
  /** The version the draft was built on — pinned on its first edit, sent
   * with the save so the store can refuse a draft another tab overtook. */
  const draftBaseRef = useRef<number | undefined>(undefined);
  const draftEpochRef = useRef(0);
  /** A save the store refused because a version landed after the draft
   * started: the author decides — drop the draft and reload, or save on
   * top of what landed. Never resolved silently either way. */
  const [staleSave, setStaleSave] = useState<{
    latestVersion: number | null;
    message: string;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  /** A refused RUN, not refused save feedback — see the Alert below. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** A refused DEPLOY from the looking-vs-live control — the only deploy
   * control there is; the version history rows never deploy. */
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
  const automationRead = readStateOf(automationQuery);
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const readErrorRef = useRef('');
  if (automationQuery.isError) {
    readErrorRef.current = automationErrorMessage(automationQuery.error);
  }
  const deployedQuery = useAutomation(
    organizationId,
    automationSlug,
    automationQuery.data?.deployedVersion,
  );
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
            readRunCursorNode(lastRun),
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
      // The base is pinned on the draft's FIRST edit: the detail query
      // follows every version another tab saves (its hint invalidates the
      // read), so reading the version at save time would name the one that
      // overtook the draft, not the one it was built on.
      if (draft === null) {
        draftBaseRef.current = automationQuery.data?.version;
        draftEpochRef.current += 1;
      }
      setDraft(patchNode(automation, selectedNodeId, patch));
    },
    [automation, selectedNodeId, draft, automationQuery.data?.version],
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
    draftEpochRef.current += 1;
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

  // A `?version=` the automation does not have: the automation itself is
  // there (its tabs stay above), so say which version is missing and offer
  // the latest — never the "Automation not found" page.
  if (
    version !== undefined &&
    automationQuery.isError &&
    automationErrorCode(automationQuery.error) === 'AUTOMATION_VERSION_UNKNOWN'
  ) {
    return (
      <ContentArea variant="narrow">
        <EmptyState
          icon={SearchX}
          title={t('editor.versionNotFound.title', { version })}
          description={t('editor.versionNotFound.description')}
          headingLevel={2}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                onSelectVersion(undefined);
              }}
            >
              {t('editor.versionNotFound.openLatest')}
            </Button>
          }
        />
      </ContentArea>
    );
  }
  // The shell already answers an unknown slug; this catches a read that
  // answered nothing at all (the route answers 404 for that too).
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
  if (automationRead.unavailable) {
    return (
      <ContentArea variant="narrow">
        <CatalogLoadError
          message={`${t('detail.loadFailed.title')}: ${readErrorRef.current}`}
          isRetrying={automationRead.retrying}
          failureKey={automationRead.failureCount}
          onRetry={() => void automationQuery.refetch()}
          onFocusLost={() => editorRegionRef.current?.focus()}
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
      {
        onSuccess: () => setRunRequest(null),
        onError: (error) => setRefusal(automationErrorMessage(error)),
      },
    );
  };

  const lookingVersion = meta?.version;
  const lookingIsLive =
    lookingVersion !== undefined && lookingVersion === meta?.deployedVersion;
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  /** Append the draft as a version built on `baseVersion` (none: append
   * whatever the latest is), then show the version that landed. */
  const submitSave = async (baseVersion: number | undefined): Promise<void> => {
    const submittedEpoch = draftEpochRef.current;
    const saved = await save.mutateAsync({
      organizationId,
      automation,
      // Package metadata belongs to the version being edited, even when
      // the author only changes a node or its canvas position.
      ...(automationQuery.data?.presentation !== undefined && {
        presentation: automationQuery.data.presentation,
      }),
      ...(automationQuery.data?.settings !== undefined && {
        settings: automationQuery.data.settings,
      }),
      ...(automationQuery.data?.taskContract !== undefined && {
        taskContract: automationQuery.data.taskContract,
      }),
      ...(saveMessage !== '' && { message: saveMessage }),
      // Binds a NEW automation to this project on its first save; an
      // existing one keeps its bindings (membership is managed in the
      // Projects panel, never moved by saving a version).
      ...(projectId !== undefined && { projectId }),
      ...(baseVersion !== undefined && { baseVersion }),
    });
    if (draftEpochRef.current !== submittedEpoch) return;
    setSaveDialogOpen(false);
    draftBaseRef.current = saved.version;
    setDraft((current) => (current === automation ? null : current));
    setSaveMessage('');
    // The save appended a version; show it, whichever one was on screen.
    onSelectVersion(undefined);
  };
  const confirmSave = async (): Promise<void> => {
    const pending = pendingSaveRef.current;
    try {
      await submitSave(draftBaseRef.current);
      pendingSaveRef.current = null;
      pending?.resolve();
    } catch (error) {
      pendingSaveRef.current = null;
      setSaveDialogOpen(false);
      if (automationErrorCode(error) === 'AUTOMATION_VERSION_STALE') {
        // Another version landed after the draft started. Not a failure the
        // Save cluster reports: the dialog below carries the store's
        // sentence and the author decides — reload, or save on top.
        setStaleSave({
          latestVersion: automationErrorLatestVersion(error) ?? null,
          message: automationErrorMessage(error),
        });
        pending?.reject(new EditorSaveCancelledError());
        return;
      }
      // The store's refusal names the problem AND the fix; hand that sentence
      // to the Save cluster, which owns the single failure toast.
      pending?.reject(new Error(automationErrorMessage(error)));
    }
  };
  /** Save on top of the version that landed — an explicit append, never a
   * server-side merge; the overtaken version stays in the history. */
  const saveAnyway = async (): Promise<void> => {
    const stale = staleSave;
    setStaleSave(null);
    if (stale === null) return;
    try {
      await submitSave(stale.latestVersion ?? undefined);
    } catch (error) {
      toast({
        variant: 'destructive',
        description: automationErrorMessage(error),
      });
    }
  };
  /** Drop the draft and show the version that landed. */
  const reloadAfterStale = (): void => {
    setStaleSave(null);
    discardDraft();
    onSelectVersion(undefined);
  };

  // Whether a live run is actually possible right now, not just wishful:
  // there has to be a deployed version, and it has to have loaded.
  const canRunLive =
    meta?.deployedVersion !== undefined &&
    !deployedQuery.isPending &&
    deployed !== null;

  // The automation-level verbs: what to do with THIS version, not a node's
  // fields. Shared between the desktop header and the mobile canvas toolbar;
  // only the header also carries the document's Save/Discard cluster — on
  // mobile that cluster moves into a picked node's own sheet instead (the
  // `ResponsiveDialog` below), where the edit it reports on actually happens.
  const automationActions = (
    <>
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
          {t('detail.deployVersion', { version: lookingVersion })}
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
            automationSlug,
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
      {/* On mobile there's no room to explain an inert button, so an
          undeployable automation just doesn't offer one; the desktop header
          has space for the disabled state and its reason instead. */}
      {canAuthor && (canRunLive || !isMobile) && (
        <Button
          variant="secondary"
          size="sm"
          icon={Zap}
          isLoading={startRun.isPending}
          disabled={!canRunLive}
          disabledReason={t('detail.runLiveNeedsDeploy')}
          onClick={() => {
            if (meta?.deployedVersion === undefined || deployed === null)
              return;
            setRunRequest({
              automationSlug,
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
    </>
  );

  const editorActions = (
    <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
      {automationActions}
      {canAuthor && <AutomationEditorActions />}
    </div>
  );
  const canvasToolbarActions = (
    <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
      {automationActions}
    </div>
  );

  return (
    <>
      <AutomationVersionPicker
        portal
        organizationId={organizationId}
        automationSlug={automationSlug}
        projectId={projectId}
        currentVersion={lookingVersion}
        deployedVersion={meta?.deployedVersion}
        onSelectVersion={requestVersionSwitch}
        showHistory={showVersionHistory}
      />
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
        actions={isMobile ? undefined : editorActions}
      />
      {/* Edge to edge: this tab is a workbench, not a page of content — the
          canvas runs to the tab strip, the section panel and the window's
          edges, and the inspector stands against its side as a panel (a design
          tool's layout), never a card floating in an inset. `flex-1
          lg:min-h-0` hands the grid the height the header and tab strip
          leave, so the workbench fills the window — a picked node never
          grows this row: `lg` up it takes a column beside the canvas, below
          it it opens in a sheet over the canvas instead, so the canvas is
          always a fixed box, never a list, and the page never scrolls to
          reach it. No nav-pill clearance reserved here either: like a
          table's rows, the canvas's background runs behind the pill, and its
          own zoom cluster and action toolbar (`FlowCanvas`) keep themselves
          clear of it instead of the workbench flooring on it site-wide. */}
      <div
        ref={editorRegionRef}
        role="region"
        aria-label={t('navigation.editor')}
        tabIndex={-1}
        className="mobile-nav-clearance flex min-w-0 flex-1 flex-col pb-[var(--mobile-floating-actions-pad,0px)] lg:min-h-0"
      >
        {/* A refused RUN, kept inline: it is the engine's own account of why
            nothing started, which the author has to read next to the automation
            it concerns. Save feedback goes through the editor cluster instead.
            The alerts keep the page inset, in a band above the workbench. */}
        {(refusal !== null || deployRefusal !== null) && (
          <div className="border-border flex flex-col gap-3 border-b p-4">
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
          </div>
        )}

        <div
          className={cn(
            AUTOMATION_EDITOR_WORKBENCH_GRID,
            selectedNode !== null && AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
          )}
        >
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
              framed={false}
              centerActions={isMobile ? canvasToolbarActions : undefined}
              {...(runStatusByNode !== undefined && { runStatusByNode })}
            />
          </div>
          {/* Only a picked node opens the inspector; until then the canvas
              runs to the window's edge. With a side panel to put it in
              (`lg` up) it opens there; below that there is no panel to
              stack against, so it opens in the sheet below instead — never
              both, `isWorkbenchCompact` picks exactly one. */}
          {selectedNode !== null && !isWorkbenchCompact && (
            <NodeInspector
              id={inspectorId}
              variant="panel"
              node={selectedNode}
              nodeType={nodeTypes.find((def) => def.type === selectedNode.type)}
              catalogUnavailable={catalogQuery.isError}
              runView={
                showLastRun
                  ? lastRunProjection.byNode.get(selectedNode.id)
                  : undefined
              }
              readOnly={!canAuthor}
              onChange={onChangeNode}
              organizationId={organizationId}
              {...(projectId !== undefined && { projectId })}
              onDeselect={deselectNode}
            />
          )}
        </div>
      </div>

      {/* The compact counterpart of the side panel above: a picked node's
          fields in a sheet over the canvas instead of pushed below it. Kept
          mounted for as long as the viewport stays compact, `open` toggling
          with the selection, so a deselect plays the sheet's own close
          animation instead of the content vanishing under it. Save/Discard
          sit in a sticky bar under the fields — the usual dialog placement —
          rather than at the top, so they stay reachable however far the
          sheet is scrolled. */}
      {isWorkbenchCompact && (
        <ResponsiveDialog
          open={selectedNode !== null}
          onOpenChange={(open) => {
            if (!open) deselectNode();
          }}
        >
          <ResponsiveDialogContent
            hideClose
            className="flex max-h-[85dvh] flex-col"
          >
            {selectedNode !== null && (
              <>
                <ResponsiveDialogTitle className="sr-only">
                  {selectedNode.id}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="sr-only">
                  {t('editor.nodeSheetDescription')}
                </ResponsiveDialogDescription>
                <NodeFields
                  headingId={inspectorId}
                  node={selectedNode}
                  nodeType={nodeTypes.find(
                    (def) => def.type === selectedNode.type,
                  )}
                  catalogUnavailable={catalogQuery.isError}
                  runView={
                    showLastRun
                      ? lastRunProjection.byNode.get(selectedNode.id)
                      : undefined
                  }
                  readOnly={!canAuthor}
                  onChange={onChangeNode}
                  organizationId={organizationId}
                  {...(projectId !== undefined && { projectId })}
                  onDeselect={deselectNode}
                />
                {canAuthor && (
                  <div className="bg-background border-border sticky bottom-0 z-10 -mb-6 flex items-center justify-end gap-2 border-t pt-3 pb-6">
                    <AutomationEditorActions />
                  </div>
                )}
              </>
            )}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

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
          projects={projects}
          pending={startRun.isPending}
          error={refusal}
          onClose={() => {
            setRunRequest(null);
            setRefusal(null);
          }}
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
          discardDraft();
          if (pendingVersion !== null) onSelectVersion(pendingVersion);
          setPendingVersion(null);
        }}
      />

      <ConfirmDialog
        open={staleSave !== null}
        onOpenChange={(open) => {
          // Backing out keeps the draft: nothing is saved and nothing is
          // dropped until the author picks a side.
          if (!open) setStaleSave(null);
        }}
        title={t('detail.staleVersion.title')}
        description={t('detail.staleVersion.description', {
          message: staleSave?.message ?? '',
        })}
        confirmText={t('detail.staleVersion.saveAnyway')}
        variant="warning"
        onConfirm={() => {
          void saveAnyway();
        }}
      >
        <Button type="button" variant="secondary" onClick={reloadAfterStale}>
          {t('detail.staleVersion.reload')}
        </Button>
      </ConfirmDialog>
    </>
  );
}
