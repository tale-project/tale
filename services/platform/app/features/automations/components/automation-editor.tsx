'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import {
  preloadCodeEditor,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import { locateYamlPointer } from '@tale/ui/code-editor/locate';
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
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Input } from '@tale/ui/input';
import { IssueFocusProvider, useRequestIssueFocus } from '@tale/ui/issue-focus';
import type { IssueItem, IssueListHandle } from '@tale/ui/issue-list';
import {
  IssueAnnouncer,
  IssueCountButton,
  type IssueCounts,
} from '@tale/ui/issue-summary';
import { PageActionHeader } from '@tale/ui/page-action-header';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
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
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useProjectHarnesses,
  useProjects,
} from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { failureDetail } from '@/app/lib/backend/adapters';
import { readStateOf } from '@/app/lib/backend/read-state';
import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import { ptr } from '@/lib/engine/core/syntax/pointer';
import type { NodeDef, Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { savedWarningsSchema } from '@/lib/shared/schemas/automation-issues';
import { stableStringify } from '@/lib/shared/utils/stable-stringify';

import { mergeNodeTypes } from '../hooks/backend';
import {
  useDeployAutomation,
  useSaveAutomation,
  useStartAutomationRun,
} from '../hooks/mutations';
import {
  useAutomation,
  useAutomationProjects,
  useAutomationRun,
  useAutomationRuns,
  useAutomationTriggers,
  useNodeTypeCatalog,
} from '../hooks/queries';
import {
  useAutomationValidation,
  useInvalidateAutomationValidation,
  VALIDATION_DEBOUNCE_MS,
} from '../hooks/use-automation-validation';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { automationDetailPathname } from '../lib/detail-paths';
import { DOCUMENT_DIRTY_KEY } from '../lib/dirty-keys';
import { readDocument } from '../lib/document';
import {
  applyDocumentPatch,
  applyNodePatch,
  rawDocumentOf,
  type DocumentPatch,
  type RawDocument,
} from '../lib/draft-document';
import type { AutomationEditorView } from '../lib/editor-search';
import {
  automationErrorCode,
  automationErrorIssues,
  automationErrorLatestVersion,
  automationErrorMessage,
  isMissingAutomationRead,
  type AutomationErrorIssues,
} from '../lib/errors';
import { END_ID, START_ID, flowGraphTarget } from '../lib/flow-ids';
import { fieldsWithIssueControl } from '../lib/inspector-fields';
import {
  issueCountsByNode,
  sortIssues,
  toIssueView,
  withIssueIds,
  type AutomationIssue,
} from '../lib/issues';
import { nodeCatalogView, nodeTitle } from '../lib/node-face';
import {
  cursorNodeStatus,
  nodeStatusMap,
  projectRun,
  readRunCursorNode,
  readRunStatus,
} from '../lib/run-view';
import { triggerLines, triggerRows } from '../lib/trigger-summary';
import {
  AUTOMATION_EDITOR_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_WORKBENCH_COMPACT_QUERY,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from '../lib/workbench';
import { SOURCE_ISSUE_ANCHOR, yamlSource } from '../lib/yaml-source';
import { AutomationCanvas, type CanvasRun } from './automation-canvas';
import { AutomationEditorActions } from './automation-editor-actions';
import {
  AutomationProblemsDock,
  AutomationProblemsSheet,
  type ProblemsFilter,
} from './automation-problems';
import {
  AutomationRunDialog,
  type AutomationRunRequest,
} from './automation-run-dialog';
import { AutomationSourceView } from './automation-source-view';
import { AutomationVersionPicker } from './automation-version-picker';
import { CodingAgentButton } from './coding-agent-entry';
import { EndFields, EndInspector } from './end-inspector';
import {
  NodeFields,
  NodeInspector,
  type InspectorContext,
} from './node-inspector';
import type { ShapeStatus } from './node-shape-panel';
import { StartFields, StartInspector } from './start-inspector';

/** The run-scope Select's "organization-wide" choice. A Radix Select item
 * cannot carry an empty value, so the org-wide option needs a real sentinel
 * that maps back to an omitted `projectId`. */
const RUN_SCOPE_ORG_WIDE = '__org_wide__';

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
  /** The route's `?view=`: the chart or the List view. */
  view?: AutomationEditorView;
  /** The route's `?node=`: the node (or Start, or End) to open on load. */
  node?: string;
  /** The reader switched the view or opened a node (`null`: closed it); the
   * route keeps it in the URL without a history entry. */
  onSearchChange?: (change: {
    view?: AutomationEditorView;
    node?: string | null;
  }) => void;
}

/**
 * A draft as the canvas draws it: at a pause in the edits (the pause the
 * draft check waits for too), and gone at once when the draft goes, so a
 * discarded draft never comes back for a moment under the next one.
 */
function usePausedDraft(draft: Automation | null): Automation | null {
  const [paused, setPaused] = useState<Automation | null>(null);
  useEffect(() => {
    if (draft === null) {
      setPaused(null);
      return undefined;
    }
    const handle = setTimeout(() => setPaused(draft), VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draft]);
  return draft === null ? null : paused;
}

/** Route parameters can change without unmounting the page. Keep the draft
 * and inspector state with one automation in one scope — the version on the
 * canvas is the route's search, so it already belongs to the new URL — while
 * the shared dirty guard still confirms navigation before these props change. */
export function AutomationEditor(props: AutomationEditorProps) {
  // The inspector's fields are code: start loading the editor with the page,
  // so the first node opened finds it ready.
  useEffect(() => {
    preloadCodeEditor();
  }, []);
  return (
    // "Go to" a problem: the Problems list asks, the inspector's controls
    // answer — one registry for the page, the node sheet included.
    <IssueFocusProvider>
      <AutomationEditorScope
        key={JSON.stringify([
          props.organizationId,
          props.automationSlug,
          props.projectId ?? null,
        ])}
        {...props}
      />
    </IssueFocusProvider>
  );
}

/** The problems a refused save or deploy listed, for the document it refused. */
interface ServerIssues {
  /** Hash of the document they belong to. */
  hash: string;
  errors: AutomationIssue[];
  warnings: AutomationIssue[];
  /** The check's result when they arrived: a newer one replaces them. */
  basis: readonly AutomationIssue[];
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
 *
 * For an author, the document on screen is checked as it changes
 * (`useAutomationValidation`): the Problems button counts what the check
 * found, the dock under the canvas (a sheet on narrow screens) lists it,
 * node boxes and fields carry their own problems, and Save stays disabled,
 * with the reason, while errors stand. A save or deploy the server refuses
 * for errors lands in the same list — one report, never a second toast.
 */
function AutomationEditorScope({
  organizationId,
  automationSlug,
  projectId,
  version,
  showVersionHistory,
  onSelectVersion,
  view: viewParam,
  node: nodeParam,
  onSearchChange,
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
  /** The box open in the inspector: a node's id, Start or End. A `?node=`
   * link opens its box on load. */
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    nodeParam === undefined || flowGraphTarget(nodeParam).kind === 'gate'
      ? null
      : nodeParam,
  );
  // The open node follows into the URL (`?node=`), replacing the entry.
  const writtenNodeRef = useRef<string | null>(selectedId);
  useEffect(() => {
    if (writtenNodeRef.current === selectedId) return;
    writtenNodeRef.current = selectedId;
    onSearchChange?.({ node: selectedId });
  }, [selectedId, onSearchChange]);
  const deselectNode = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    if (id !== null) {
      queueMicrotask(() => {
        focusAutomationNode(id);
      });
    }
  }, [selectedId]);
  /** The draft: the raw document with the author's edits (see
   * `../lib/draft-document`) — what the check, a save and the Source view
   * read. The canvas and the inspector read its narrowed view. */
  const [draft, setDraft] = useState<RawDocument | null>(null);
  /** The version the draft was built on — pinned on its first edit, sent
   * with the save so the store can refuse a draft another tab overtook. */
  const draftBaseRef = useRef<number | undefined>(undefined);
  /** The same base, for the notice that a newer version landed under the
   * draft. */
  const [draftBase, setDraftBase] = useState<number | undefined>(undefined);
  /** The document the draft started from: the canvas keeps drawing it until
   * the first pause in the edits. */
  const [draftOrigin, setDraftOrigin] = useState<Automation | null>(null);
  /** The version this tab saved last: following it to the latest is no
   * news to its author. */
  const savedHereRef = useRef<number | undefined>(undefined);
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
  const deployedRead = readStateOf(deployedQuery);
  const deployedReadError =
    automationQuery.data?.deployedVersion !== undefined &&
    (deployedRead.unavailable || deployedRead.stale);
  const deployedFailureDetail = failureDetail(deployedQuery.error);
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

  const storedRaw = useMemo(
    () => rawDocumentOf(automationQuery.data?.document),
    [automationQuery.data?.document],
  );
  const stored = useMemo(() => readDocument(storedRaw), [storedRaw]);
  const deployed = useMemo(
    () => readDocument(deployedQuery.data?.document),
    [deployedQuery.data?.document],
  );
  const draftView = useMemo(
    () => (draft === null ? null : readDocument(draft)),
    [draft],
  );
  const automation = draftView ?? stored;
  /** The document on screen as stored or edited, every key kept. */
  const rawDocument = draft ?? storedRaw;
  // The canvas redraws a draft at a pause in the edits — the pause the
  // check waits for too — so typing a reference never relays it out per
  // keystroke; until the first pause it keeps the document the draft started
  // from, whatever version lands meanwhile. A stored version (opened, saved,
  // switched to) shows at once.
  const pausedDraft = usePausedDraft(draftView);
  const canvasDocument =
    draftView === null ? stored : (pausedDraft ?? draftOrigin ?? stored);

  const runs = runsQuery.data ?? [];
  const lastRun = runs[0];
  // Start's and End's Last run tabs show the run's input and output, which
  // only the run's own read carries: it is asked for while one is open.
  const runDetailQuery = useAutomationRun(
    organizationId,
    showLastRun &&
      lastRun !== undefined &&
      (selectedId === START_ID || selectedId === END_ID)
      ? lastRun.id
      : undefined,
  );
  const shownRunDetail = runDetailQuery.data ?? undefined;
  const lastRunProjection = useMemo(
    () => projectRun(showLastRun ? lastRun : null),
    [showLastRun, lastRun],
  );
  const runStatusByNode = useMemo(
    () =>
      showLastRun && lastRun
        ? nodeStatusMap(
            lastRunProjection,
            (automation?.nodes ?? []).map((node) => node.id),
            readRunCursorNode(lastRun),
            cursorNodeStatus(lastRun),
          )
        : undefined,
    [showLastRun, lastRun, lastRunProjection, automation?.nodes],
  );

  const nodeTypes = useMemo(
    () => mergeNodeTypes(catalogQuery.data?.nodeTypes),
    [catalogQuery.data?.nodeTypes],
  );

  // ── Problems ──────────────────────────────────────────────────────────
  // What the engine finds in the document on screen. Members never have one
  // checked: the route is author-gated, and they cannot change it anyway.
  const invalidateValidation = useInvalidateAutomationValidation(
    organizationId,
    automationSlug,
  );
  const { locale } = useLocale();
  const requestIssueFocus = useRequestIssueFocus();
  const validation = useAutomationValidation({
    organizationId,
    automationSlug,
    document: rawDocument,
    isDraft: draft !== null,
    enabled: canAuthor,
  });
  /** A refused save's or deploy's own list, shown until the document
   * changes or the check settles anew. */
  const [serverIssues, setServerIssues] = useState<ServerIssues | null>(null);
  const shownServerIssues =
    serverIssues !== null &&
    serverIssues.hash === validation.currentHash &&
    serverIssues.basis === validation.errors
      ? serverIssues
      : null;
  const shownErrors = shownServerIssues?.errors ?? validation.errors;
  const shownWarnings = shownServerIssues?.warnings ?? validation.warnings;
  const issueStatus =
    shownServerIssues === null ? validation.status : ('ready' as const);
  const issueCounts = useMemo<IssueCounts>(
    () => ({ errors: shownErrors.length, warnings: shownWarnings.length }),
    [shownErrors, shownWarnings],
  );
  const controlsOf = useCallback(
    (node: NodeDef) =>
      fieldsWithIssueControl(
        node,
        nodeTypes.find((def) => def.type === node.type)?.allowedFields ?? [],
      ),
    [nodeTypes],
  );
  const issueViews = useMemo(
    () =>
      automation === null
        ? []
        : sortIssues([...shownErrors, ...shownWarnings]).map((issue) =>
            toIssueView(issue, automation, { locale, t, controlsOf }),
          ),
    [automation, shownErrors, shownWarnings, locale, t, controlsOf],
  );
  const issueItems = useMemo(
    () => issueViews.map((view) => view.item),
    [issueViews],
  );
  // Read against the document the canvas draws, which settles at a pause
  // like the check does: a keystroke gives the canvas no new counts, so it
  // never redraws every node per keystroke.
  const countsByNode = useMemo(
    () =>
      canvasDocument === null
        ? new Map<string, IssueCounts>()
        : issueCountsByNode([...shownErrors, ...shownWarnings], canvasDocument),
    [canvasDocument, shownErrors, shownWarnings],
  );

  // ── The canvas ────────────────────────────────────────────────────────
  // What the canvas draws besides the document: the catalog's words and
  // icons, the served models' names, what starts a run, what the check
  // worked out, and the last run.
  const triggersQuery = useAutomationTriggers(organizationId, automationSlug);
  const harnesses = useProjectHarnesses(organizationId);
  const { formatDate } = useFormatDate();
  const catalog = useMemo(
    () => nodeCatalogView(nodeTypes, catalogQuery.data?.connectors ?? []),
    [nodeTypes, catalogQuery.data?.connectors],
  );
  const modelNames = useMemo(
    () =>
      new Map(
        (harnesses.data?.models ?? []).map((model) => [model.id, model.label]),
      ),
    [harnesses.data?.models],
  );
  const modelLabel = useCallback(
    (id: string) => modelNames.get(id),
    [modelNames],
  );
  const deployedVersionNow = automationQuery.data?.deployedVersion;
  const triggerRowsShown = useMemo(
    () =>
      triggerRows(
        triggerLines(triggersQuery.data ?? [], {
          deployed: deployedVersionNow !== undefined,
          t,
        }),
        { t, formatDate: (at) => formatDate(at, 'long') },
      ),
    [triggersQuery.data, deployedVersionNow, t, formatDate],
  );
  const validationTypes = validation.types ?? null;
  const validationAnalysis = validation.analysis ?? null;
  const canvasCheck = useMemo(
    () => ({
      status: !canAuthor
        ? ('off' as const)
        : validation.status === 'idle' || validation.status === 'checking'
          ? ('pending' as const)
          : validation.status,
      analysis: validationAnalysis,
      types: validationTypes,
    }),
    [canAuthor, validation.status, validationAnalysis, validationTypes],
  );
  const startNotice = useMemo(() => {
    const cause = issueViews.find(
      (view) => view.issue.code === 'TRIGGER_INPUT_MISMATCH',
    )?.item.cause;
    return typeof cause === 'string' ? cause : null;
  }, [issueViews]);
  const canvasRun = useMemo<CanvasRun | undefined>(
    () =>
      showLastRun && lastRun && runStatusByNode !== undefined
        ? {
            statusByNode: runStatusByNode,
            projection: lastRunProjection,
            status: readRunStatus(lastRun.status),
          }
        : undefined,
    [showLastRun, lastRun, runStatusByNode, lastRunProjection],
  );
  const layoutKey = `${automationSlug}:${version ?? 'latest'}`;

  /** A box picked on the canvas: a node, Start or End opens its inspector,
   * a condition opens its node at the condition's field. */
  // The document as typed, read when a box is picked rather than closed
  // over: the canvas keeps one handler however many keystrokes land.
  const automationRef = useRef(automation);
  useLayoutEffect(() => {
    automationRef.current = automation;
  });
  const selectOnCanvas = useCallback(
    (id: string | null) => {
      if (id === null) {
        setSelectedId(null);
        return;
      }
      const target = flowGraphTarget(id);
      if (target.kind !== 'gate') {
        setSelectedId(id);
        return;
      }
      setSelectedId(target.nodeId);
      const index =
        automationRef.current?.nodes.findIndex(
          (node) => node.id === target.nodeId,
        ) ?? -1;
      if (index >= 0) requestIssueFocus(ptr('nodes', index, 'when'));
    },
    [requestIssueFocus],
  );

  // ── The inspector ────────────────────────────────────────────────────
  // What a node's inspector reads besides the node: when it runs (the flow
  // facts of the document the canvas draws, so typing never re-works them
  // per keystroke), the check's shapes and failure reasons, and where the
  // check stands for the marks in its code fields.
  const canvasNodes = canvasDocument?.nodes;
  const flowFacts = useMemo(
    () => (canvasNodes === undefined ? null : analyzeFlow(canvasNodes)),
    [canvasNodes],
  );
  const diagnosticsStatus: CodeEditorDiagnosticsStatus =
    validation.status === 'failed'
      ? 'failed'
      : validation.status === 'ready' &&
          validation.settledFor === validation.currentHash
        ? 'ready'
        : 'checking';
  const shapeStatus: ShapeStatus | 'off' = !canAuthor
    ? 'off'
    : validation.status === 'failed'
      ? 'failed'
      : validationTypes === null
        ? 'pending'
        : diagnosticsStatus === 'ready'
          ? 'ready'
          : 'checking';
  const settledDocument = validation.settledDocument;
  const sampleOf = useCallback(
    (nodeId: string) =>
      showLastRun ? lastRunProjection.byNode.get(nodeId)?.output : undefined,
    [showLastRun, lastRunProjection],
  );
  const inspectorContext = useMemo<InspectorContext | null>(
    () =>
      automation === null
        ? null
        : {
            doc: automation,
            flow: flowFacts,
            analysis: validationAnalysis,
            types: validationTypes,
            shapeStatus,
            diagnosticsStatus,
            settled: settledDocument,
            catalog,
            modelLabel,
            onSelect: (id) => selectOnCanvas(id),
            sampleOf,
          },
    [
      automation,
      flowFacts,
      validationAnalysis,
      validationTypes,
      shapeStatus,
      diagnosticsStatus,
      settledDocument,
      catalog,
      modelLabel,
      selectOnCanvas,
      sampleOf,
    ],
  );

  const [viewChoice, setViewChoice] = useState<
    AutomationEditorView | undefined
  >(viewParam);
  // Below 24rem the chart is too narrow to read; the List view says the same.
  const narrowCanvas = useMediaQuery('(width < 24rem)');
  const canvasView =
    viewChoice === 'list' || (viewChoice === undefined && narrowCanvas)
      ? ('list' as const)
      : ('chart' as const);
  const showSource = viewChoice === 'source';
  const changeView = useCallback(
    (next: AutomationEditorView) => {
      setViewChoice(next);
      onSearchChange?.({ view: next });
    },
    [onSearchChange],
  );

  // ── A newer version saved elsewhere ─────────────────────────────────
  // Following the latest (no `?version=`), a version another window or a
  // coding agent saves replaces the one on screen: with no draft the
  // canvas glides to it, rings what changed and says so; under a draft
  // nothing moves, and a notice offers to show it.
  const shownVersion = automationQuery.data?.version;
  const [canvasChange, setCanvasChange] = useState<
    { ids: ReadonlySet<string>; key: number } | undefined
  >(undefined);
  const [canvasNews, setCanvasNews] = useState({ text: '', key: 0 });
  const seenRef = useRef<{
    version: number | undefined;
    asked: number | undefined;
    doc: Automation | null;
  }>({ version: shownVersion, asked: version, doc: stored });
  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { version: shownVersion, asked: version, doc: stored };
    if (
      seen.version === undefined ||
      shownVersion === undefined ||
      seen.version === shownVersion ||
      seen.asked !== version ||
      version !== undefined ||
      shownVersion < seen.version ||
      savedHereRef.current === shownVersion ||
      draft !== null ||
      stored === null ||
      seen.doc === null
    ) {
      return;
    }
    const before = new Map(
      seen.doc.nodes.map((node) => [node.id, stableStringify(node)]),
    );
    setCanvasChange({
      ids: new Set(
        stored.nodes
          .filter((node) => before.get(node.id) !== stableStringify(node))
          .map((node) => node.id),
      ),
      key: shownVersion,
    });
    const said = [t('canvas.updated', { version: shownVersion })];
    if (
      selectedId !== null &&
      flowGraphTarget(selectedId).kind === 'node' &&
      !stored.nodes.some((node) => node.id === selectedId)
    ) {
      said.push(t('canvas.selectionRemoved', { node: nodeTitle(selectedId) }));
      setSelectedId(null);
    }
    setCanvasNews((previous) => ({
      text: said.join(' '),
      key: previous.key + 1,
    }));
  }, [shownVersion, version, stored, draft, selectedId, t]);
  const newerVersion =
    draft !== null &&
    version === undefined &&
    draftBase !== undefined &&
    shownVersion !== undefined &&
    shownVersion > draftBase &&
    savedHereRef.current !== shownVersion
      ? shownVersion
      : null;

  /** The problems the open inspector shows: a node's, or Start's (the
   * run input's schema), or End's (the output). */
  const selectedIssues = useMemo(() => {
    if (selectedId === null) return [];
    const target = flowGraphTarget(selectedId);
    return issueViews.filter(({ navigation }) => {
      switch (navigation.kind) {
        case 'start':
        case 'end':
          return navigation.kind === target.kind;
        case 'field':
        case 'node':
          return target.kind === 'node' && navigation.nodeId === selectedId;
        default:
          return false;
      }
    });
  }, [issueViews, selectedId]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  /** Which problems the panel shows; every open and every refusal starts
   * on all of them, so no filter hides what the reader came for. */
  const [problemsFilter, setProblemsFilter] = useState<ProblemsFilter>('all');
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  /** The Problems sheet is closing to take the reader to a field. */
  const [handingOn, setHandingOn] = useState(false);
  /** The phone's node sheet is closing onto the Problems sheet. */
  const [nodeSheetHandsOn, setNodeSheetHandsOn] = useState(false);
  useEffect(() => {
    if (selectedId !== null) setNodeSheetHandsOn(false);
  }, [selectedId]);
  /** Focus the list once the panel has opened: on its current row, or on
   * the first error when a refusal opened it. */
  const [focusProblems, setFocusProblems] = useState<
    'current' | 'firstError' | null
  >(null);
  /** The save dialog closes onto the Problems list, not back onto Save. */
  const [saveClosesOnProblems, setSaveClosesOnProblems] = useState(false);
  const problemsButtonRef = useRef<HTMLButtonElement>(null);
  const problemsListRef = useRef<IssueListHandle>(null);
  const problemsDockId = useId();
  /** One sentence when a draft's check changes the counts, and one per
   * refusal. A check runs at every pause in typing; the same counts again
   * are no news, so they are not said again. */
  const [announcement, setAnnouncement] = useState<{
    key: number;
    context?: string;
  }>({ key: 0 });
  /** The counts last said — seeded by the stored version's own check, so
   * the first pause in editing a clean version says nothing. */
  const announcedCountsRef = useRef<IssueCounts | null>(null);
  useEffect(() => {
    if (validation.status !== 'ready' || validation.settledFor === null) {
      return;
    }
    const counts = {
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    };
    const last = announcedCountsRef.current;
    announcedCountsRef.current = counts;
    if (draft === null) return;
    if (
      last !== null &&
      last.errors === counts.errors &&
      last.warnings === counts.warnings
    ) {
      return;
    }
    setAnnouncement((previous) => ({ key: previous.key + 1 }));
  }, [
    draft,
    validation.status,
    validation.settledFor,
    validation.errors,
    validation.warnings,
  ]);
  useEffect(() => {
    if (focusProblems === null || !problemsOpen) return undefined;
    const frame = requestAnimationFrame(() => {
      const firstError =
        focusProblems === 'firstError'
          ? issueViews.find((view) => view.issue.level === 'error')?.issue.id
          : undefined;
      problemsListRef.current?.focus(firstError);
      setFocusProblems(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusProblems, problemsOpen, issueViews]);

  /**
   * Show what a refused save or deploy listed, and take the reader there.
   * `context` leads the spoken counts; leave it out where an alert already
   * says what was refused.
   */
  const showRefusal = useCallback(
    (refused: AutomationErrorIssues, hash: string, context?: string) => {
      setServerIssues({
        hash,
        errors: withIssueIds(refused.errors),
        warnings: withIssueIds(refused.warnings),
        basis: validation.errors,
      });
      setHandingOn(false);
      setProblemsFilter('all');
      setProblemsOpen(true);
      setFocusProblems('firstError');
      announcedCountsRef.current = {
        errors: refused.errors.length,
        warnings: refused.warnings.length,
      };
      setAnnouncement((previous) => ({
        key: previous.key + 1,
        ...(context !== undefined && { context }),
      }));
    },
    [validation.errors],
  );
  const toggleProblems = (): void => {
    if (problemsOpen) {
      setProblemsOpen(false);
      return;
    }
    setHandingOn(false);
    setProblemsFilter('all');
    setProblemsOpen(true);
    // Opening lands on the list's current row, so the arrow keys walk it at
    // once. The sheet does that itself as it opens; the dock is no dialog.
    if (!isWorkbenchCompact) setFocusProblems('current');
  };
  const closeProblems = (): void => {
    setProblemsOpen(false);
    problemsButtonRef.current?.focus();
  };
  /** From the phone's node sheet, where Save waits on problems the canvas
   * toolbar's button lists: close the node, open the list on its errors. */
  const showProblemsFromNode = (): void => {
    setNodeSheetHandsOn(true);
    setSelectedId(null);
    setHandingOn(false);
    setProblemsFilter('all');
    setProblemsOpen(true);
    setFocusProblems('firstError');
  };
  /** "Go to": open the box (a node, Start, End) or the Source view, then
   * focus the field and select the text. */
  const goToIssue = (item: IssueItem): void => {
    const view = issueViews.find((candidate) => candidate.issue.id === item.id);
    if (view === undefined || view.navigation.kind === 'unavailable') return;
    const { navigation } = view;
    setActiveIssueId(item.id);
    if (isWorkbenchCompact) {
      // The box's own sheet, or the Source view, takes over from this one.
      setHandingOn(true);
      setProblemsOpen(false);
    }
    switch (navigation.kind) {
      case 'source': {
        changeView('source');
        // The range in the YAML the Source view shows: the text on screen
        // now, so it is the one the request's offsets index into.
        const located =
          rawDocument === null
            ? null
            : locateYamlPointer(yamlSource(rawDocument), navigation.pointer, {
                ...(navigation.range !== undefined && {
                  range: navigation.range,
                }),
                ...(navigation.subject !== undefined && {
                  subject: navigation.subject,
                }),
              });
        requestIssueFocus(
          SOURCE_ISSUE_ANCHOR,
          located === null ? undefined : [located.from, located.to],
        );
        return;
      }
      case 'start':
      case 'end':
        setSelectedId(navigation.kind === 'start' ? START_ID : END_ID);
        requestIssueFocus(navigation.anchor, navigation.range);
        return;
      case 'field':
        setSelectedId(navigation.nodeId);
        requestIssueFocus(navigation.anchor, navigation.range);
        return;
      default:
        setSelectedId(navigation.nodeId);
        requestIssueFocus(ptr('nodes', navigation.nodeIndex));
    }
  };

  /** The draft after one more edit. Its base is pinned on its FIRST edit:
   * the detail query follows every version another tab saves (its hint
   * invalidates the read), so reading the version at save time would name
   * the one that overtook the draft, not the one it was built on. */
  const editDraft = useCallback(
    (edit: (raw: RawDocument) => RawDocument) => {
      if (!automation || rawDocument === null) return;
      if (draft === null) {
        draftBaseRef.current = automationQuery.data?.version;
        setDraftBase(automationQuery.data?.version);
        setDraftOrigin(automation);
        draftEpochRef.current += 1;
      }
      setDraft(edit(rawDocument));
    },
    [automation, rawDocument, draft, automationQuery.data?.version],
  );
  const onChangeNode = useCallback(
    (patch: Partial<NodeDef>) => {
      if (selectedId === null) return;
      editDraft((raw) => applyNodePatch(raw, selectedId, patch));
    },
    [editDraft, selectedId],
  );
  /** Start edits the run input's schema, End the output. */
  const onChangeDocument = useCallback(
    (patch: DocumentPatch) => {
      editDraft((raw) => applyDocumentPatch(raw, patch));
    },
    [editDraft],
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
        setSaveClosesOnProblems(false);
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
    setDraftBase(undefined);
    setDraftOrigin(null);
  }, []);

  // Save waits while the check stands on errors — the draft's own, or,
  // while its check runs, the last one's. A check that failed blocks
  // nothing: the server checks every save and refuses an invalid one.
  const errorCount = shownErrors.length;
  const saveBlocked =
    errorCount > 0 && (issueStatus === 'ready' || issueStatus === 'checking');
  const invalidReason = !saveBlocked
    ? undefined
    : issueStatus === 'checking'
      ? t('problems.checkingDraft')
      : t('problems.saveBlocked', { count: errorCount });
  const controller = useMemo<EditorController>(
    () => ({
      isDirty,
      isSaving: save.isPending,
      isValid: !saveBlocked,
      ...(invalidReason !== undefined && { invalidReason }),
      isLoading: automationQuery.isPending,
      dirtyKeys: isDirty ? DOCUMENT_DIRTY_KEYS : NO_DIRTY_KEYS,
      save: requestSave,
      reset: discardDraft,
    }),
    [
      isDirty,
      save.isPending,
      saveBlocked,
      invalidReason,
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
    automation.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedNodeIndex = automation.nodes.findIndex(
    (node) => node.id === selectedId,
  );
  /** What the inspector shows: a node, Start or End; null while closed. */
  const inspected =
    selectedNode !== null
      ? ('node' as const)
      : selectedId === START_ID
        ? ('start' as const)
        : selectedId === END_ID
          ? ('end' as const)
          : null;
  /** Append the draft as a version built on `baseVersion` (none: append
   * whatever the latest is), then show the version that landed. */
  const submitSave = async (baseVersion: number | undefined): Promise<void> => {
    const submittedEpoch = draftEpochRef.current;
    const submittedHash = validation.currentHash;
    const submitted = rawDocument;
    const saved = await save.mutateAsync({
      organizationId,
      automation: submitted,
      // Package metadata belongs to the version being edited, even when
      // the author only changes a node.
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
    // A save can change what the checks of this automation read (the
    // versions its calls resolve to); the version's own check settles anew,
    // and until it does the warnings the save let through stand in for it.
    invalidateValidation();
    const savedWarnings = savedWarningsSchema.safeParse(saved);
    if (
      submittedHash !== null &&
      savedWarnings.success &&
      savedWarnings.data.warnings.length > 0
    ) {
      setServerIssues({
        hash: submittedHash,
        errors: [],
        warnings: withIssueIds(savedWarnings.data.warnings),
        basis: validation.errors,
      });
    }
    draftBaseRef.current = saved.version;
    setDraftBase(saved.version);
    savedHereRef.current = saved.version;
    setDraft((current) => (current === submitted ? null : current));
    setSaveMessage('');
    // The save appended a version; show it, whichever one was on screen.
    onSelectVersion(undefined);
  };
  /** A refusal for errors, with its list, for the document on screen. */
  const refusalIssues = (error: unknown): AutomationErrorIssues | undefined =>
    automationErrorCode(error) === 'AUTOMATION_INVALID'
      ? automationErrorIssues(error)
      : undefined;
  const confirmSave = async (): Promise<void> => {
    const pending = pendingSaveRef.current;
    const submittedHash = validation.currentHash;
    try {
      await submitSave(draftBaseRef.current);
      pendingSaveRef.current = null;
      pending?.resolve();
    } catch (error) {
      pendingSaveRef.current = null;
      const refused = refusalIssues(error);
      if (refused !== undefined && submittedHash !== null) {
        // The server's check found errors: they land in Problems, which is
        // the one report — the Save cluster stays silent.
        setSaveClosesOnProblems(true);
        setSaveDialogOpen(false);
        showRefusal(refused, submittedHash, t('problems.refusedSave'));
        pending?.reject(new EditorSaveCancelledError());
        return;
      }
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
    const submittedHash = validation.currentHash;
    try {
      await submitSave(stale.latestVersion ?? undefined);
    } catch (error) {
      const refused = refusalIssues(error);
      if (refused !== undefined && submittedHash !== null) {
        showRefusal(refused, submittedHash, t('problems.refusedSave'));
        return;
      }
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
    deployed !== null &&
    !deployedReadError;

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
                  // The version on screen no longer passes the check: its
                  // problems land in Problems, and the alert points there.
                  // With a draft on screen they would describe another
                  // document, so the alert keeps the server's sentence.
                  const refused =
                    draft === null ? refusalIssues(error) : undefined;
                  const hash = validation.currentHash;
                  if (refused !== undefined && hash !== null) {
                    // The alert says the deploy was refused (it is read
                    // out); the announcer adds only the counts.
                    showRefusal(refused, hash);
                    setDeployRefusal(t('problems.refusedDeploy'));
                    return;
                  }
                  setDeployRefusal(
                    automationErrorCode(error) === 'AUTOMATION_INVALID'
                      ? t('problems.refusedDeployDraft')
                      : automationErrorMessage(error),
                  );
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
          disabledReason={
            deployedReadError
              ? t('detail.runLiveNeedsDeployedRead')
              : t('detail.runLiveNeedsDeploy')
          }
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
      {canAuthor && (
        // Last of the automation's own verbs, right before Save: what the
        // check found decides whether Save can act.
        <IssueCountButton
          ref={problemsButtonRef}
          counts={issueCounts}
          status={
            issueStatus === 'checking'
              ? 'checking'
              : issueStatus === 'failed'
                ? 'failed'
                : 'ready'
          }
          expanded={problemsOpen}
          {...(problemsOpen &&
            !isWorkbenchCompact && { controls: problemsDockId })}
          onClick={toggleProblems}
        />
      )}
    </>
  );

  /** The open box's inspector: beside the canvas in its frame (`panel`),
   * or bare inside the phone's sheet, which has a frame of its own. */
  const inspector = (
    context: InspectorContext,
    place: 'panel' | 'sheet',
  ): React.ReactNode => {
    const shared = {
      readOnly: !canAuthor,
      onDeselect: deselectNode,
      issues: selectedIssues,
      context,
    };
    if (inspected === 'start') {
      const props = {
        ...shared,
        triggers: triggerRowsShown,
        generalHref: `${automationDetailPathname({
          organizationId,
          automationSlug,
          ...(projectId !== undefined && { projectId }),
        })}/general`,
        onChange: onChangeDocument,
        ...(shownRunDetail !== undefined && {
          run: { input: shownRunDetail.input },
        }),
      };
      return place === 'panel' ? (
        <StartInspector id={inspectorId} variant="panel" {...props} />
      ) : (
        <StartFields headingId={inspectorId} {...props} />
      );
    }
    if (inspected === 'end') {
      const props = {
        ...shared,
        onChange: onChangeDocument,
        ...(shownRunDetail !== undefined && {
          run: { output: shownRunDetail.output },
        }),
      };
      return place === 'panel' ? (
        <EndInspector id={inspectorId} variant="panel" {...props} />
      ) : (
        <EndFields headingId={inspectorId} {...props} />
      );
    }
    if (selectedNode === null) return null;
    const props = {
      ...shared,
      node: selectedNode,
      nodeType: nodeTypes.find((def) => def.type === selectedNode.type),
      catalogUnavailable: catalogQuery.isError,
      runView: showLastRun
        ? lastRunProjection.byNode.get(selectedNode.id)
        : undefined,
      onChange: onChangeNode,
      organizationId,
      ...(projectId !== undefined && { projectId }),
      nodeIndex: selectedNodeIndex,
    };
    return place === 'panel' ? (
      <NodeInspector id={inspectorId} variant="panel" {...props} />
    ) : (
      <NodeFields
        // As in the panel: each node opens on its own fields, so no
        // half-typed text follows the reader to the next node.
        key={selectedNode.id}
        headingId={inspectorId}
        {...props}
      />
    );
  };

  const editorActions = (
    <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
      {automationActions}
      {canAuthor && <AutomationEditorActions />}
    </div>
  );
  const viewSwitch = (
    <SegmentedControl
      aria-label={t('canvas.view.label')}
      value={showSource ? 'source' : canvasView === 'list' ? 'list' : 'canvas'}
      onValueChange={(next) =>
        changeView(
          next === 'source' ? 'source' : next === 'list' ? 'list' : 'canvas',
        )
      }
      options={[
        { value: 'canvas', label: t('canvas.view.canvas') },
        { value: 'list', label: t('canvas.view.list') },
        { value: 'source', label: t('canvas.view.source') },
      ]}
      className="bg-background shadow-sm"
    />
  );
  const codingAgentButton = canAuthor ? (
    <CodingAgentButton
      organizationId={organizationId}
      automationSlug={automationSlug}
    />
  ) : null;
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
        {(refusal !== null ||
          deployRefusal !== null ||
          deployedReadError ||
          newerVersion !== null) && (
          <div className="border-border flex flex-col gap-3 border-b p-4">
            {newerVersion !== null && draftBase !== undefined && (
              <Alert
                variant="info"
                title={t('canvas.newerVersion.title')}
                description={t('canvas.newerVersion.body', {
                  version: newerVersion,
                  base: draftBase,
                })}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={discardDraft}
                >
                  {t('canvas.newerVersion.show', { version: newerVersion })}
                </Button>
              </Alert>
            )}
            {deployedReadError && (
              <CatalogLoadError
                message={
                  deployedFailureDetail === undefined
                    ? t('detail.deployedReadFailed')
                    : `${t('detail.deployedReadFailed')}: ${deployedFailureDetail}`
                }
                onRetry={() => void deployedQuery.refetch()}
                isRetrying={deployedRead.retrying}
                failureKey={deployedRead.failureCount}
              />
            )}
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
            inspected !== null && AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
          )}
        >
          <div className={AUTOMATION_WORKBENCH_CANVAS_SLOT}>
            {showSource && rawDocument !== null ? (
              <AutomationSourceView
                document={rawDocument}
                settled={settledDocument}
                issues={issueViews}
                diagnosticsStatus={diagnosticsStatus}
                automationSlug={automationSlug}
                version={lookingVersion}
                isDraft={isDirty}
                viewSwitch={viewSwitch}
                actions={codingAgentButton}
                {...(isMobile && { toolbar: canvasToolbarActions })}
                showEditHint={canAuthor}
              />
            ) : (
              canvasDocument !== null && (
                <AutomationCanvas
                  automation={canvasDocument}
                  layoutKey={layoutKey}
                  catalog={catalog}
                  modelLabel={modelLabel}
                  triggers={triggerRowsShown}
                  check={canvasCheck}
                  startNotice={startNotice}
                  issueCounts={countsByNode}
                  selectedId={selectedId}
                  onSelect={selectOnCanvas}
                  revealId={selectedId}
                  inspectorId={inspectorId}
                  {...(canvasRun !== undefined && { run: canvasRun })}
                  {...(canvasChange !== undefined && { changed: canvasChange })}
                  framed={false}
                  view={canvasView}
                  onViewChange={(next) =>
                    changeView(next === 'list' ? 'list' : 'canvas')
                  }
                  topStart={viewSwitch}
                  topEnd={
                    <>
                      {lastRun ? (
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          aria-pressed={showLastRun}
                          title={
                            showLastRun
                              ? t('detail.hideLastRun')
                              : t('detail.showLastRun')
                          }
                          tooltipSide="bottom"
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
                      ) : null}
                      {codingAgentButton}
                    </>
                  }
                  {...(isMobile && { toolbar: canvasToolbarActions })}
                  {...(canAuthor && {
                    emptyAction: (
                      <CodingAgentButton
                        organizationId={organizationId}
                        automationSlug={automationSlug}
                        variant="primary"
                      />
                    ),
                  })}
                />
              )
            )}
            {/* Under the canvas, spanning its column only, so the inspector
                beside it keeps its full height. Below `lg` the list opens
                in a sheet instead (further down). */}
            {canAuthor && problemsOpen && !isWorkbenchCompact && (
              <AutomationProblemsDock
                ref={problemsListRef}
                id={problemsDockId}
                items={issueItems}
                counts={issueCounts}
                status={issueStatus === 'idle' ? 'ready' : issueStatus}
                activeId={activeIssueId}
                onActivate={goToIssue}
                filter={problemsFilter}
                onFilterChange={setProblemsFilter}
                onClose={closeProblems}
              />
            )}
          </div>
          {/* Only a picked node opens the inspector; until then the canvas
              runs to the window's edge. With a side panel to put it in
              (`lg` up) it opens there; below that there is no panel to
              stack against, so it opens in the sheet below instead — never
              both, `isWorkbenchCompact` picks exactly one. */}
          {inspectorContext !== null &&
            !isWorkbenchCompact &&
            inspector(inspectorContext, 'panel')}
        </div>
      </div>

      {canAuthor && isWorkbenchCompact && (
        <AutomationProblemsSheet
          open={problemsOpen}
          onOpenChange={(open) => {
            if (!open) setProblemsOpen(false);
          }}
          items={issueItems}
          counts={issueCounts}
          status={issueStatus === 'idle' ? 'ready' : issueStatus}
          activeId={activeIssueId}
          onActivate={goToIssue}
          filter={problemsFilter}
          onFilterChange={setProblemsFilter}
          listRef={problemsListRef}
          handingOn={handingOn}
        />
      )}
      {/* What changed on the canvas while the reader looked: a version
          saved elsewhere, a node it no longer has. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-slot="canvas-announcer"
      >
        {canvasNews.text === '' ? null : (
          <span key={canvasNews.key}>{canvasNews.text}</span>
        )}
      </div>
      {canAuthor && (
        <IssueAnnouncer
          counts={issueCounts}
          status="ready"
          announceKey={announcement.key}
          {...(announcement.context !== undefined && {
            context: announcement.context,
          })}
        />
      )}

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
          open={inspected !== null}
          onOpenChange={(open) => {
            if (!open) deselectNode();
          }}
        >
          <ResponsiveDialogContent
            hideClose
            className="flex max-h-[85dvh] flex-col"
            // Closing onto the Problems sheet: its list takes focus.
            preventCloseAutoFocus={nodeSheetHandsOn}
          >
            {inspected !== null && inspectorContext !== null && (
              <>
                <ResponsiveDialogTitle className="sr-only">
                  {inspected === 'start'
                    ? t('editor.start.title')
                    : inspected === 'end'
                      ? t('editor.end.title')
                      : nodeTitle(selectedNode?.id ?? '')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="sr-only">
                  {inspected === 'start'
                    ? t('editor.start.description')
                    : inspected === 'end'
                      ? t('editor.end.description')
                      : t('editor.nodeSheetDescription')}
                </ResponsiveDialogDescription>
                {inspector(inspectorContext, 'sheet')}
                {canAuthor && (
                  <div className="bg-background border-border sticky bottom-0 z-10 -mb-6 flex flex-wrap items-center justify-end gap-2 border-t pt-3 pb-6">
                    {/* The problems that hold Save back may sit in other
                        nodes, and the Problems button is behind this
                        sheet: a way there beside the reason. */}
                    {saveBlocked && isDirty && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="mr-auto px-0"
                        onClick={showProblemsFromNode}
                      >
                        {t('problems.open')}
                      </Button>
                    )}
                    {/* No pointer hovers a sheet: why Save waits is a
                        visible line here, not a tooltip. */}
                    <AutomationEditorActions inlineReason />
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
        // A refusal for errors closes the dialog onto the Problems list,
        // which takes focus itself.
        preventCloseAutoFocus={saveClosesOnProblems}
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
