'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ChangeSummary } from '@tale/ui/change-list';
import { cn } from '@tale/ui/cn';
import {
  preloadCodeEditor,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import { locateYamlPointer } from '@tale/ui/code-editor/locate';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
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
import {
  TestCountButton,
  TestRunAnnouncer,
  type TestResultListHandle,
} from '@tale/ui/test-results';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useToast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Rocket,
  SearchX,
  Undo2,
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
import { llmModelSteps } from '@/lib/automations/model-defaults';
import { testForPath } from '@/lib/automations/tests/path-test';
import { triggerTestInput } from '@/lib/automations/tests/samples';
import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import { diffAutomationDocuments } from '@/lib/engine/core/diff/automation';
import {
  changedNodeIds,
  changeSummaryOf,
} from '@/lib/engine/core/diff/changes';
import { ptr } from '@/lib/engine/core/syntax/pointer';
import type { NodeDef, Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import { savedWarningsSchema } from '@/lib/shared/schemas/automation-issues';

import { mergeNodeTypes } from '../hooks/backend';
import {
  useSaveAutomation,
  useStartAutomationRun,
  useTryAutomation,
} from '../hooks/mutations';
import {
  useApprovalAllowances,
  useAutomation,
  useAutomationProjects,
  useAutomationRun,
  useAutomationRuns,
  useAutomationTriggers,
  useNodeTypeCatalog,
} from '../hooks/queries';
import { testRowId, useAutomationTests } from '../hooks/use-automation-tests';
import {
  documentHash,
  useAutomationValidation,
  useInvalidateAutomationValidation,
  VALIDATION_DEBOUNCE_MS,
} from '../hooks/use-automation-validation';
import { useDeployVersion } from '../hooks/use-deploy-version';
import { focusAutomationNode } from '../hooks/use-deselect-on-escape';
import { useTimelineWords } from '../hooks/use-timeline-words';
import { coveredCount, pathCoverage } from '../lib/automation-tests/coverage';
import { testsOf } from '../lib/automation-tests/test-draft';
import { formOwnsPlace, readTestForm } from '../lib/automation-tests/test-form';
import {
  testRunOf,
  transientStatus,
  transientTrace,
  type TransientOverlay,
  type TransientRunLike,
  type TransientStatus,
} from '../lib/automation-tests/transient-run';
import {
  automationDetailPathname,
  compareVersionLink,
  versionsTabLink,
} from '../lib/detail-paths';
import { DOCUMENT_DIRTY_KEY } from '../lib/dirty-keys';
import { readDocument } from '../lib/document';
import {
  applyDocumentPatch,
  applyNodePatch,
  rawDocumentOf,
  type DocumentPatch,
  type RawDocument,
} from '../lib/draft-document';
import type {
  AutomationEditorPanel,
  AutomationEditorSearchChange,
  AutomationEditorView,
} from '../lib/editor-search';
import {
  automationErrorCode,
  automationErrorIssues,
  automationErrorLatestVersion,
  automationErrorMessage,
  automationVersionStale,
  isMissingAutomationRead,
  type AutomationErrorIssues,
  type StaleChange,
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
import {
  actionTitle,
  connectorName,
  effectTitle,
  nodeCatalogView,
  nodeTitle,
} from '../lib/node-face';
import { pathClauses } from '../lib/paths';
import {
  cursorNodeStatus,
  nodeStatusMap,
  projectRun,
  readRunCursorNode,
  readRunStatus,
} from '../lib/run-view';
import { triggerLines, triggerRows } from '../lib/trigger-summary';
import { changeFlags } from '../lib/version-changes';
import {
  AUTOMATION_EDITOR_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_WORKBENCH_COMPACT_QUERY,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from '../lib/workbench';
import { SOURCE_ISSUE_ANCHOR, yamlSource } from '../lib/yaml-source';
import { AutomationCanvas, type CanvasRun } from './automation-canvas';
import { AutomationDock } from './automation-dock';
import { AutomationEditorActions } from './automation-editor-actions';
import {
  AutomationProblemsSheet,
  type ProblemsFilter,
} from './automation-problems';
import {
  AutomationRunDialog,
  type AutomationRunRequest,
  type RunTarget,
} from './automation-run-dialog';
import { AutomationSourceView } from './automation-source-view';
import { AutomationTestsSheet } from './automation-tests/automation-tests-panel';
import {
  TestFields,
  TestInspector,
  type TestInspectorTab,
  type TestSetupMode,
} from './automation-tests/test-inspector';
import { testIssueAnchor, testYaml } from './automation-tests/test-yaml-editor';
import {
  TransientRunBanner,
  type TransientRunState,
} from './automation-try/transient-run-banner';
import { AutomationVersionPicker } from './automation-version-picker';
import { CodingAgentButton } from './coding-agent-entry';
import { EndFields, EndInspector } from './end-inspector';
import { LlmModelSwapDialog } from './llm-model-swap-dialog';
import {
  NodeFields,
  NodeInspector,
  type InspectorContext,
} from './node-inspector';
import type { ShapeStatus } from './node-shape-panel';
import { StartFields, StartInspector } from './start-inspector';
import {
  type DeployedTrigger,
  TriggerDeployNotice,
} from './trigger-deploy-notice';
import { DeployRefusedDialog } from './versions/deploy-refused-dialog';
import { useAuthorText, VersionAuthor } from './versions/version-author';
import {
  useVersionChangeSections,
  VersionChanges,
} from './versions/version-changes';

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
  /** The route's `?panel=`: the panel under the canvas to open on load. */
  panel?: AutomationEditorPanel;
  /** The route's `?test=`: the test to open on load, by its place. */
  test?: number;
  /** The reader switched the view, opened a node, a panel or a test
   * (`null`: closed it); the route keeps it in the URL without a history
   * entry. */
  onSearchChange?: (change: AutomationEditorSearchChange) => void;
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

/** A refusal for errors, with its list, for the document on screen. */
function refusalIssues(error: unknown): AutomationErrorIssues | undefined {
  return automationErrorCode(error) === 'AUTOMATION_INVALID'
    ? automationErrorIssues(error)
    : undefined;
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
  panel: panelParam,
  test: testParam,
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
  /** The latest version when the draft started — pinned on its first edit,
   * sent with the save so the store refuses a draft another tab overtook. */
  const draftBaseRef = useRef<number | undefined>(undefined);
  /** The same base, for the notice that a newer version landed under the
   * draft. */
  const [draftBase, setDraftBase] = useState<number | undefined>(undefined);
  /** The version the draft was built from — the one on screen at its first
   * edit, an older one too: the save records it, and editing an old
   * version saves a new one based on it rather than refusing. */
  const draftBasedOnRef = useRef<number | undefined>(undefined);
  const [draftBasedOn, setDraftBasedOn] = useState<number | undefined>(
    undefined,
  );
  /** The document the draft started from: the canvas keeps drawing it until
   * the first pause in the edits. */
  const [draftOrigin, setDraftOrigin] = useState<Automation | null>(null);
  /** The same document as stored, every key kept: the save review compares
   * the draft with it, even after a newer version replaced it on the read. */
  const [draftOriginRaw, setDraftOriginRaw] = useState<RawDocument | null>(
    null,
  );
  /** The version this tab saved last: following it to the latest is no
   * news to its author. */
  const savedHereRef = useRef<number | undefined>(undefined);
  const draftEpochRef = useRef(0);
  /** A save the store refused because a version landed after the draft
   * started: the author decides — drop the draft and reload, or save on
   * top of what landed. Never resolved silently either way. */
  const [staleSave, setStaleSave] = useState<{
    latestVersion: number | null;
    /** Who saved the newer version, when and how, as the refusal says. */
    stale: StaleChange | null;
    message: string;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  /** A refused RUN, not refused save feedback — see the Alert below. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** A refused DEPLOY from the looking-vs-live control — the only deploy
   * control there is; the version history rows never deploy. */
  const [deployRefusal, setDeployRefusal] = useState<string | null>(null);
  /** The trigger a deploy left off, for the automation it was deployed
   * for: the notice offers to turn it on. */
  const [deployNotice, setDeployNotice] = useState<{
    name: string;
    trigger: DeployedTrigger;
  } | null>(null);
  const deployNoticeRef = useRef<HTMLDivElement>(null);
  const [showLastRun, setShowLastRun] = useState(true);
  /** A run that was never stored, laid over the canvas in place of the
   * last run: a try of the draft, or a test's latest run. */
  const [overlay, setOverlay] = useState<TransientOverlay | null>(null);
  /** Why a try of the draft was refused, said in the run dialog. */
  const [tryRefusal, setTryRefusal] = useState<string | null>(null);
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
  // Deployed, the version on screen is live and Deploy leaves the page; its
  // focus goes to what the deploy left to do, if anything.
  const deployHandoffRef = useFocusHandoff<HTMLSpanElement>(() =>
    (deployNoticeRef.current ?? editorRegionRef.current)?.focus(),
  );
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
  const tryRun = useTryAutomation();

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
  const authorText = useAuthorText(organizationId);
  const navigate = useNavigate();
  const { schedule: scheduleText } = useRecurrenceFormat();
  const catalog = useMemo(
    () => nodeCatalogView(nodeTypes, catalogQuery.data?.connectors ?? []),
    [nodeTypes, catalogQuery.data?.connectors],
  );
  // The save dialog's review, worked out only while it is open: what the
  // draft changes in the version it started from, even once a newer version
  // has replaced that one on the read.
  const reviewBaseRaw = draftOriginRaw ?? storedRaw;
  const reviewDiff = useMemo(
    () =>
      saveDialogOpen && draft !== null && reviewBaseRaw !== null
        ? diffAutomationDocuments(reviewBaseRaw, draft)
        : null,
    [saveDialogOpen, draft, reviewBaseRaw],
  );
  const reviewBase = useMemo(
    () => (draftOriginRaw === null ? stored : readDocument(draftOriginRaw)),
    [draftOriginRaw, stored],
  );
  const reviewSections = useVersionChangeSections({
    diff: reviewDiff,
    before: reviewBase,
    after: automation,
    labels: {
      before: t('versions.versionLabel', {
        version: draftBasedOn ?? automationQuery.data?.version ?? 0,
      }),
      after: t('detail.saveDialog.draftLabel'),
    },
    catalog,
  });
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
  // What this automation may write without a person: its boxes say so. A
  // rule of the organization's approval policy that requires a person wins
  // over an allowance, so such a write keeps its plain mark.
  const allowancesQuery = useApprovalAllowances(
    organizationId,
    automationSlug,
    canAuthor,
  );
  const allowedWrites = useMemo(
    () =>
      new Set(
        (allowancesQuery.data?.actions ?? [])
          .filter(
            (action) =>
              action.allowance !== null && action.policy !== 'requires',
          )
          .map((action) => action.type),
      ),
    [allowancesQuery.data],
  );
  const deployedVersionNow = automationQuery.data?.deployedVersion;
  const triggerRowsShown = useMemo(
    () =>
      triggerRows(
        triggerLines(triggersQuery.data ?? [], {
          deployed: deployedVersionNow !== undefined,
          t,
          scheduleText,
        }),
        { t, formatDate: (at) => formatDate(at, 'long') },
      ),
    [triggersQuery.data, deployedVersionNow, t, scheduleText, formatDate],
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
  const lastCanvasRun = useMemo<CanvasRun | undefined>(
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
  // A try or a test's run belongs to the document it ran: another version
  // or automation on screen takes it off the canvas.
  const [overlayKey, setOverlayKey] = useState(layoutKey);
  if (overlayKey !== layoutKey) {
    setOverlayKey(layoutKey);
    setOverlay(null);
  }

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
            allowedWrites,
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
      allowedWrites,
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
    raw: RawDocument | null;
  }>({ version: shownVersion, asked: version, raw: storedRaw });
  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { version: shownVersion, asked: version, raw: storedRaw };
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
      storedRaw === null ||
      seen.raw === null
    ) {
      return;
    }
    // The ring marks what the version history says this version changed:
    // the nodes added, changed or renamed — `ui` aside.
    setCanvasChange({
      ids: changedNodeIds(diffAutomationDocuments(seen.raw, storedRaw)),
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
  }, [shownVersion, version, stored, storedRaw, draft, selectedId, t]);
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
  const [problemsOpen, setProblemsOpen] = useState(panelParam === 'problems');
  /** The Tests panel is the dock's other tab: one of the two shows. */
  const [testsOpen, setTestsOpen] = useState(
    panelParam === 'tests' ||
      (panelParam === undefined && testParam !== undefined),
  );
  useEffect(() => {
    if (problemsOpen) setTestsOpen(false);
  }, [problemsOpen]);
  const dockPanel: AutomationEditorPanel | null = problemsOpen
    ? 'problems'
    : testsOpen
      ? 'tests'
      : null;
  // The open panel follows into the URL (`?panel=`), replacing the entry.
  const writtenPanelRef = useRef<AutomationEditorPanel | null>(dockPanel);
  useEffect(() => {
    if (writtenPanelRef.current === dockPanel) return;
    writtenPanelRef.current = dockPanel;
    onSearchChange?.({ panel: dockPanel });
  }, [dockPanel, onSearchChange]);
  const [modelSwapOpen, setModelSwapOpen] = useState(false);
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
  const testsButtonRef = useRef<HTMLButtonElement>(null);
  const testsListRef = useRef<TestResultListHandle>(null);
  const problemsDockId = useId();
  /** The test open in the inspector, by its place; a `?test=` link opens
   * it on load. A test and a box are never open together. */
  const [selectedTest, setSelectedTest] = useState<number | null>(
    testParam ?? null,
  );
  const [testTab, setTestTab] = useState<TestInspectorTab>('setup');
  /** Setup as the form, or as YAML for what the form has no control for. */
  const [testSetupMode, setTestSetupMode] = useState<TestSetupMode>('form');
  useEffect(() => {
    if (selectedId !== null) setSelectedTest(null);
  }, [selectedId]);
  // On a phone a test opens in a sheet of its own, never over the list's.
  useEffect(() => {
    if (isWorkbenchCompact && selectedTest !== null) setTestsOpen(false);
  }, [isWorkbenchCompact, selectedTest]);
  const writtenTestRef = useRef<number | null>(selectedTest);
  useEffect(() => {
    if (writtenTestRef.current === selectedTest) return;
    writtenTestRef.current = selectedTest;
    onSearchChange?.({ test: selectedTest });
  }, [selectedTest, onSearchChange]);
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
  // The editor's Deploy: one click against the live version on screen, with
  // Undo; a version that fails the checks lists its problems in Problems.
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
    onTriggerOff: (off) => {
      // A trigger that is off starts nothing this version runs; the notice
      // offers to turn it on.
      setDeployNotice(
        off === null ? null : { name: automationSlug, trigger: off },
      );
    },
    onRefused: (error) => {
      // The version on screen no longer passes the check: its problems land
      // in Problems, and the alert points there. With a draft on screen they
      // would describe another document, so the alert says so instead.
      const refused = draft === null ? refusalIssues(error) : undefined;
      const hash = validation.currentHash;
      if (refused !== undefined && hash !== null) {
        // The alert says the deploy was refused (it is read out); the
        // announcer adds only the counts.
        showRefusal(refused, hash);
        setDeployRefusal(t('problems.refusedDeploy'));
        return true;
      }
      if (automationErrorCode(error) === 'AUTOMATION_INVALID') {
        setDeployRefusal(t('problems.refusedDeployDraft'));
        return true;
      }
      return false;
    },
  });
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
      case 'test': {
        const index = navigation.testIndex;
        setProblemsOpen(false);
        // On a phone the test's own sheet takes over; the list's would
        // only stand behind it.
        if (!isWorkbenchCompact || index === null) setTestsOpen(true);
        const test = index === null ? undefined : testsOf(rawDocument)[index];
        if (index === null || test === undefined) return;
        setSelectedId(null);
        setSelectedTest(index);
        setTestTab('setup');
        // A place the form has a control for opens there; the control finds
        // the place inside its own value.
        if (formOwnsPlace(navigation.pointer, index)) {
          setTestSetupMode('form');
          requestIssueFocus(navigation.pointer, navigation.range);
          return;
        }
        setTestSetupMode('yaml');
        // The range in the test's YAML on screen: the text the request's
        // offsets index into.
        const located = locateYamlPointer(
          testYaml(test),
          navigation.pointer.slice(testIssueAnchor(index).length),
          {
            ...(navigation.range !== undefined && { range: navigation.range }),
            ...(navigation.subject !== undefined && {
              subject: navigation.subject,
            }),
          },
        );
        requestIssueFocus(
          testIssueAnchor(index),
          located === null ? undefined : [located.from, located.to],
        );
        return;
      }
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
        const shown = automationQuery.data;
        const latest = shown?.latestVersion ?? shown?.version;
        draftBaseRef.current = latest;
        setDraftBase(latest);
        draftBasedOnRef.current = shown?.version;
        setDraftBasedOn(shown?.version);
        setDraftOrigin(automation);
        setDraftOriginRaw(rawDocument);
        draftEpochRef.current += 1;
      }
      setDraft(edit(rawDocument));
    },
    [automation, rawDocument, draft, automationQuery.data],
  );
  // ── Tests ─────────────────────────────────────────────────────────────
  // The document's tests with their latest results, under the canvas in the
  // dock's Tests tab; one opens in the inspector.
  const testText = useMemo(
    () => ({
      effectLabel: (connector: string) =>
        effectTitle(connector, { t, catalog, locale }),
    }),
    [t, catalog, locale],
  );
  const tests = useAutomationTests({
    organizationId,
    automationSlug,
    draft,
    storedRaw,
    version: automationQuery.data?.version,
    enabled: canAuthor,
    editDraft,
    text: testText,
  });
  /** The open test, while the document on screen still has it. */
  const shownTest =
    selectedTest !== null && selectedTest < tests.tests.length
      ? selectedTest
      : null;

  // ── A run that was never stored, over the canvas ──────────────────────
  /** The run laid over the canvas in place of the last one, while it has
   * steps to show: a try's, or a test's latest run. */
  const overlayRun = useMemo<TransientRunLike | null>(() => {
    if (overlay === null) return null;
    if (overlay.kind === 'try') return overlay.run;
    const outcome = tests.rows[overlay.index]?.outcome;
    return outcome === undefined ? null : testRunOf(outcome);
  }, [overlay, tests.rows]);
  const overlayProjection = useMemo(
    () =>
      overlayRun === null
        ? null
        : projectRun({
            status: transientStatus(overlayRun),
            trace: transientTrace(overlayRun),
            effects: overlayRun.effects ?? [],
          }),
    [overlayRun],
  );
  const failureLabels = useMemo(
    () => ({
      connectorLabel: (slug: string) => connectorName(slug, catalog, locale),
      actionLabel: (type: string) => actionTitle(type, catalog, locale),
    }),
    [catalog, locale],
  );
  const timelineWords = useTimelineWords(failureLabels);
  const canvasRun = useMemo<CanvasRun | undefined>(() => {
    if (!showLastRun || overlayRun === null || overlayProjection === null) {
      return lastCanvasRun;
    }
    return {
      statusByNode: nodeStatusMap(
        overlayProjection,
        (automation?.nodes ?? []).map((node) => node.id),
      ),
      projection: overlayProjection,
      status: transientStatus(overlayRun),
      ...(overlayRun.record !== undefined && {
        record: overlayRun.record.view,
        words: timelineWords,
      }),
    };
  }, [
    showLastRun,
    overlayRun,
    overlayProjection,
    lastCanvasRun,
    automation?.nodes,
    timelineWords,
  ]);
  /** Where the inspector reads what the run on the canvas did. */
  const shownProjection = overlayProjection ?? lastRunProjection;
  const overlayOutcome =
    overlay?.kind === 'test' ? tests.rows[overlay.index]?.outcome : undefined;
  /** Whose run the inspector's run tab shows, when not the last run. */
  const overlayLabel =
    overlay === null || overlayRun === null
      ? undefined
      : overlay.kind === 'try'
        ? t('editor.inspector.tabs.runTry')
        : t('editor.inspector.tabs.runTest');
  /** What Start shows the run on the canvas received. */
  const overlayInput =
    overlay === null
      ? undefined
      : overlay.kind === 'try'
        ? overlay.input
        : readTestForm(tests.tests[overlay.index]).input;
  // A try is judged against the draft as it is now: one changed since
  // says so, and Try again runs the draft as it is.
  const draftHash = useMemo(
    () =>
      overlay?.kind === 'try' && rawDocument !== null
        ? documentHash(rawDocument)
        : null,
    [overlay?.kind, rawDocument],
  );
  /** Runs the draft as it is now, once and kept nowhere, and lays its run
   * over the canvas with the banner. A refusal is said where the try
   * started: in the run dialog, or above the canvas for Try again. */
  const tryDraft = (input: unknown, from: 'dialog' | 'banner'): void => {
    if (rawDocument === null) return;
    const sentHash = documentHash(rawDocument);
    if (from === 'dialog') setTryRefusal(null);
    else setRefusal(null);
    tryRun.mutate(
      {
        organizationId,
        name: automationSlug,
        document: rawDocument,
        ...(input !== undefined && { input }),
      },
      {
        onSuccess: ({ run }) => {
          setRunRequest(null);
          setShowLastRun(true);
          setOverlay({
            kind: 'try',
            run,
            input,
            documentHash: sentHash,
            at: Date.now(),
          });
        },
        onError: (error) => {
          const message = automationErrorMessage(error);
          if (from === 'dialog') setTryRefusal(message);
          else setRefusal(message);
        },
      },
    );
  };
  /** Lays a test's latest run over the canvas; on a phone the sheets
   * close, so the canvas shows it. */
  const showTestRun = (index: number): void => {
    setOverlay({ kind: 'test', index });
    setShowLastRun(true);
    if (isWorkbenchCompact) {
      setTestsOpen(false);
      setSelectedTest(null);
    }
  };
  /** Runs the shown run again: the draft as it is now, with the same
   * input, or the test. A try still going is not started twice — the
   * banner holds its button, and the key does nothing until it answers. */
  const tryAgain =
    overlay === null || overlayRun === null
      ? undefined
      : overlay.kind === 'try'
        ? () => {
            if (!tryRun.isPending) tryDraft(overlay.input, 'banner');
          }
        : tests.runDisabledReason === undefined
          ? () => tests.runOne(overlay.index)
          : undefined;
  // Mod-Shift-Enter tries again while the canvas or the inspector beside it
  // has focus — the latest Try again, read when the key is pressed.
  const workbenchRef = useRef<HTMLDivElement>(null);
  const tryAgainRef = useRef(tryAgain);
  useEffect(() => {
    tryAgainRef.current = tryAgain;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const again = tryAgainRef.current;
      const area = workbenchRef.current;
      if (again === undefined || area === null) return;
      if (!(event.target instanceof Node) || !area.contains(event.target)) {
        return;
      }
      event.preventDefault();
      again();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /** How the shown run ended, in words. */
  const overlayWords = (run: TransientRunLike, ms: number): string => {
    if (run.stoppedBy === 'time_limit') {
      return t('try.timeLimit', {
        seconds: Math.max(1, Math.round(ms / 1000)),
      });
    }
    if (run.stoppedBy !== undefined) return t('try.stopped');
    if (run.status === 'invalid') return t('try.invalid');
    if (run.status === 'error') {
      const node = run.error?.nodeId?.split('/')[0];
      return node === undefined || node === ''
        ? t('try.failed')
        : t('canvas.end.failedAt', { node: nodeTitle(node) });
    }
    return t('try.succeeded', {
      duration: t('tests.duration', { ms: Math.round(ms) }),
    });
  };
  // A test laid over the canvas says how the test came out, not only how
  // its run ended: a test can fail with a run that succeeded, and pass
  // with one that failed where it must.
  const testVerdict: { status: TransientStatus; words: string } | null =
    overlay?.kind !== 'test' || overlayOutcome?.kind !== 'run'
      ? null
      : overlayOutcome.result.pass
        ? {
            status: 'success',
            words: t('try.passed', {
              duration: t('tests.duration', {
                ms: Math.round(overlayOutcome.result.ms),
              }),
            }),
          }
        : {
            status:
              tests.rows[overlay.index]?.status === 'error'
                ? 'cancelled'
                : 'failed',
            words: tests.rows[overlay.index]?.reason ?? t('try.failed'),
          };
  const bannerState: TransientRunState | null =
    overlay === null || overlayRun === null
      ? null
      : (overlay.kind === 'try' && tryRun.isPending) ||
          (overlay.kind === 'test' && tests.running.has(overlay.index))
        ? {
            kind: 'running',
            words:
              overlay.kind === 'try' ? t('try.running') : t('try.runningTest'),
          }
        : overlay.kind === 'try'
          ? {
              kind: 'done',
              status: transientStatus(overlayRun),
              words: overlayWords(overlayRun, overlay.run.ms),
              at: overlay.at,
            }
          : {
              kind: 'done',
              ...(testVerdict ?? {
                status: transientStatus(overlayRun),
                words: overlayWords(overlayRun, 0),
              }),
              at:
                overlayOutcome !== undefined && overlayOutcome.kind !== 'none'
                  ? overlayOutcome.at
                  : 0,
            };
  const bannerChanged =
    overlay === null
      ? undefined
      : overlay.kind === 'try'
        ? draftHash !== null && draftHash !== overlay.documentHash
          ? t('try.changed')
          : undefined
        : overlayOutcome !== undefined &&
            overlayOutcome.kind !== 'none' &&
            overlayOutcome.stale
          ? t('tests.result.stale')
          : undefined;
  const transientBanner =
    bannerState === null || overlay === null || !showLastRun ? null : (
      <TransientRunBanner
        title={
          overlay.kind === 'try'
            ? t('try.unsaved')
            : t('try.test', { name: tests.rows[overlay.index]?.name ?? '' })
        }
        state={bannerState}
        {...(bannerChanged !== undefined && { changed: bannerChanged })}
        {...(tryAgain !== undefined && { onTryAgain: tryAgain })}
        {...(overlay.kind === 'test' && { againLabel: t('tests.run') })}
        onClear={() => setOverlay(null)}
      />
    );
  const [testsNews, setTestsNews] = useState({ text: '', key: 0 });
  /** The Tests sheet is closing onto a test's own sheet. */
  const [testsHandingOn, setTestsHandingOn] = useState(false);
  /** On a phone, a test's sheet takes over from the list's: one sheet at
   * a time, focus handed on. */
  const handTestsOn = (): void => {
    if (!isWorkbenchCompact) return;
    setTestsHandingOn(true);
    setTestsOpen(false);
  };
  const openTest = (index: number): void => {
    handTestsOn();
    setSelectedId(null);
    setSelectedTest(index);
    // A test with a result opens on it; one without, on its setup.
    setTestTab(tests.rows[index]?.outcome.kind === 'none' ? 'setup' : 'result');
  };
  const addTest = (from?: Readonly<Record<string, unknown>>): void => {
    const index = tests.add(from);
    if (index === null) return;
    handTestsOn();
    setSelectedId(null);
    setSelectedTest(index);
    setTestTab('setup');
  };
  const toggleTests = (): void => {
    if (testsOpen && !problemsOpen) {
      setTestsOpen(false);
      return;
    }
    setProblemsOpen(false);
    setTestsHandingOn(false);
    setTestsOpen(true);
  };
  /** Hides the dock, whichever tab shows, and hands focus back to the
   * button of the panel it showed. */
  const closeDock = (): void => {
    const shown = dockPanel;
    setProblemsOpen(false);
    setTestsOpen(false);
    (shown === 'tests' ? testsButtonRef : problemsButtonRef).current?.focus();
  };
  // Which paths the tests go down: the Tests panel counts them, and the
  // Paths list says it per path.
  const coverage = useMemo(() => pathCoverage(tests.rows), [tests.rows]);
  const listed =
    flowFacts !== null && !flowFacts.truncated && flowFacts.paths.length > 1
      ? { facts: flowFacts, paths: flowFacts.paths }
      : null;
  const listedPaths = listed?.paths ?? null;
  const [pathsOpen, setPathsOpen] = useState(false);
  const boundTrigger = triggersQuery.data?.[0];
  const triggerInput =
    boundTrigger === undefined
      ? null
      : triggerTestInput({
          kind: boundTrigger.kind,
          event: boundTrigger.event ?? null,
          input: boundTrigger.input ?? null,
        });
  const addFrom = {
    ...(triggerInput !== null && {
      trigger: () =>
        addTest({
          name: t('tests.addFrom.triggerName'),
          input: triggerInput,
          expect: {},
        }),
    }),
    ...(listed !== null &&
      automation !== null && {
        paths: listed.paths.flatMap((path, at) => {
          if (coverage.has(path.id)) return [];
          const number = at + 1;
          const clauses = pathClauses(listed.facts, path, t).map(
            (clause) => clause.label,
          );
          return [
            {
              id: path.id,
              label:
                clauses.length === 0
                  ? t('paths.row', { index: number })
                  : t('tests.addFrom.pathItem', {
                      path: t('paths.row', { index: number }),
                      clauses: new Intl.ListFormat(locale, {
                        type: 'conjunction',
                      }).format(clauses),
                    }),
              onSelect: () => {
                const made = testForPath({
                  document: { nodes: automation.nodes },
                  pathId: path.id,
                  name: t('tests.addFrom.pathName', { number }),
                  ...(validationTypes !== null && {
                    outputShapes: Object.fromEntries(
                      Object.entries(validationTypes.nodes).map(
                        ([id, info]) => [id, info.output],
                      ),
                    ),
                  }),
                  describe: (need) =>
                    need.kind === 'when'
                      ? t('tests.pathNeed.when', {
                          node: nodeTitle(need.node),
                          value: need.value ? 'true' : 'false',
                        })
                      : null,
                  failureMessage: t('tests.fields.failureDefault'),
                });
                if (made !== null) addTest({ ...made.test });
              },
            },
          ];
        }),
      }),
  };
  const testsPanel = {
    tests,
    canEdit: canAuthor,
    activeIndex: shownTest,
    onOpen: openTest,
    onAdd: () => addTest(),
    addFrom,
    ...(listedPaths !== null &&
      tests.tests.length > 0 && {
        coverage: {
          covered: coveredCount(coverage, listedPaths),
          total: listedPaths.length,
          onShowPaths: () => setPathsOpen(true),
        },
      }),
    onDeleted: (name: string) => {
      setTestsNews((previous) => ({
        text: t('tests.deleted', { name }),
        key: previous.key + 1,
      }));
    },
    onShowRun: showTestRun,
    listRef: testsListRef,
  };
  /** The open test's inspector: its YAML with the problems the check found
   * in it, and its latest result. Closing it returns to its row. */
  const testFields = (index: number) => ({
    tests,
    index,
    settledTest: testsOf(settledDocument ?? rawDocument)[index],
    issues: issueViews.filter(
      ({ navigation }) =>
        navigation.kind === 'test' && navigation.testIndex === index,
    ),
    diagnosticsStatus,
    readOnly: !canAuthor,
    tab: testTab,
    onTabChange: setTestTab,
    setupMode: testSetupMode,
    onSetupModeChange: setTestSetupMode,
    doc: automation ?? { name: automationSlug, nodes: [] },
    lastRunOutputOf: sampleOf,
    text: testText,
    onSelectNode: (nodeId: string) => {
      setSelectedTest(null);
      selectOnCanvas(nodeId);
    },
    onShowRun: () => showTestRun(index),
    onDeselect: () => {
      setSelectedTest(null);
      if (dockPanel === 'tests') testsListRef.current?.focus(testRowId(index));
      else testsButtonRef.current?.focus();
    },
  });

  const onChangeNode = useCallback(
    (patch: Partial<NodeDef>) => {
      if (selectedId === null) return;
      editDraft((raw) => applyNodePatch(raw, selectedId, patch));
    },
    [editDraft, selectedId],
  );
  /** Another model in every llm step that names `from`: one draft edit,
   * reviewed and kept like any other. */
  const swapModel = useCallback(
    (from: string, to: string) => {
      editDraft((raw) =>
        llmModelSteps(raw)
          .filter((step) => step.model === from)
          .reduce(
            (doc, step) => applyNodePatch(doc, step.nodeId, { model: to }),
            raw,
          ),
      );
    },
    [editDraft],
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
    setDraftBasedOn(undefined);
    setDraftOrigin(null);
    setDraftOriginRaw(null);
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
        onSuccess: () => {
          setRunRequest(null);
          // The run it started lies over the canvas once it is listed.
          setOverlay(null);
        },
        onError: (error) => setRefusal(automationErrorMessage(error)),
      },
    );
  };
  /** The run dialog's choice: the draft is tried, the version run. */
  const confirmRun = (
    request: AutomationRunRequest,
    input: unknown,
    target: RunTarget,
  ): void => {
    if (target === 'draft') {
      tryDraft(
        request.draft?.schema === undefined ? undefined : input,
        'dialog',
      );
      return;
    }
    scheduleRun(request, input);
  };

  const lookingVersion = meta?.version;
  const lookingIsLive =
    lookingVersion !== undefined && lookingVersion === meta?.deployedVersion;
  // Deploying an older version than the live one rolls back to it.
  const rollsBack =
    lookingVersion !== undefined &&
    meta?.deployedVersion !== undefined &&
    lookingVersion < meta.deployedVersion;
  // A version older than the latest is on screen: saving builds the next
  // version from it.
  const latestVersion = meta?.latestVersion;
  const viewingOld =
    lookingVersion !== undefined &&
    latestVersion !== undefined &&
    lookingVersion < latestVersion;
  // The newest version there is: the latest when the draft started, or one
  // saved since — a save that goes through lands on top of it.
  const newestVersion = Math.max(
    draftBase ?? 0,
    latestVersion ?? lookingVersion ?? 0,
  );
  // The draft is built from an older version than the newest: the versions
  // saved since are not in it.
  const basedOnOlder =
    draftBasedOn !== undefined && draftBasedOn < newestVersion;
  // What the version that landed under the draft changed against the one
  // before it, as its saved summary says.
  const newerChanges =
    newerVersion !== null &&
    meta?.changes !== undefined &&
    meta.changes !== null &&
    meta.changes.first !== true &&
    meta.changes.identical !== true
      ? meta.changes
      : null;
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
      ...(draftBasedOnRef.current !== undefined && {
        basedOnVersion: draftBasedOnRef.current,
      }),
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
    draftBasedOnRef.current = saved.version;
    setDraftBasedOn(saved.version);
    // Edits made while the save ran go on from the version it saved.
    setDraftOriginRaw(submitted);
    savedHereRef.current = saved.version;
    setDraft((current) => (current === submitted ? null : current));
    setSaveMessage('');
    // The save appended a version; show it, whichever one was on screen.
    onSelectVersion(undefined);
  };
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
          stale: automationVersionStale(error) ?? null,
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

  // The notice of the automation on screen; another one's is dropped.
  const shownDeployNotice =
    deployNotice?.name === automationSlug ? deployNotice.trigger : null;

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
        <span ref={deployHandoffRef} className="contents">
          <Button
            variant="secondary"
            size="sm"
            // Busy, not disabled: a disabled button drops its focus, and
            // the focus is what the notice of the deploy takes over.
            icon={
              deployer.pendingVersion !== null
                ? Loader2
                : rollsBack
                  ? Undo2
                  : Rocket
            }
            iconClassName={
              deployer.pendingVersion !== null
                ? 'animate-spin motion-reduce:animate-none'
                : undefined
            }
            aria-busy={deployer.pendingVersion !== null || undefined}
            aria-disabled={deployer.pendingVersion !== null || undefined}
            onClick={() => {
              if (deployer.pendingVersion !== null) return;
              setDeployRefusal(null);
              setDeployNotice(null);
              deployer.deploy(lookingVersion, meta?.deployedVersion ?? null);
            }}
          >
            {rollsBack
              ? t('deploy.rollBack', { version: lookingVersion })
              : t('detail.deployVersion', { version: lookingVersion })}
          </Button>
        </span>
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
            // Unsaved changes: the dialog asks whether the draft or the
            // version runs.
            ...(isDirty &&
              canAuthor && {
                draft:
                  automation?.inputs === undefined
                    ? {}
                    : { schema: automation.inputs },
              }),
          };
          if (request.schema === undefined && request.draft === undefined) {
            scheduleRun(request);
          } else {
            setTryRefusal(null);
            setRunRequest(request);
          }
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
      {canAuthor &&
        rawDocument !== null &&
        llmModelSteps(rawDocument).length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            icon={ArrowLeftRight}
            onClick={() => {
              setModelSwapOpen(true);
            }}
          >
            {t('editor.modelSwap.open')}
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
      {canAuthor && (
        <TestCountButton
          ref={testsButtonRef}
          counts={tests.counts}
          status={tests.status}
          expanded={dockPanel === 'tests'}
          {...(dockPanel === 'tests' &&
            !isWorkbenchCompact && { controls: problemsDockId })}
          onClick={toggleTests}
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
        ...(overlayLabel !== undefined
          ? { run: { input: overlayInput, label: overlayLabel } }
          : shownRunDetail !== undefined && {
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
        ...(overlayLabel !== undefined
          ? { run: { output: overlayRun?.output, label: overlayLabel } }
          : shownRunDetail !== undefined && {
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
        ? shownProjection.byNode.get(selectedNode.id)
        : undefined,
      runLabel: overlayLabel,
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

  // Who saved the version that overtook the draft, when, and what the draft
  // is based on — in words; the store's own sentence only for an
  // automation that has no version any more.
  const staleDescription = (() => {
    if (staleSave === null) return null;
    const latest = staleSave.latestVersion;
    if (latest === null) return staleSave.message;
    const stale = staleSave.stale;
    const base = draftBasedOn ?? draftBase;
    const words =
      stale === null || stale.by === null || stale.at === null
        ? t('detail.staleVersion.changed', { latest, base })
        : t('detail.staleVersion.body', {
            ...authorText({
              actor: stale.by,
              via: stale.via,
              clientName: stale.client,
            }).subject,
            latest,
            time: formatDate(new Date(stale.at), 'time'),
            base,
          });
    return (
      <>
        {words}{' '}
        <Link
          {...compareVersionLink({
            organizationId,
            automationSlug,
            projectId,
            version: latest,
            from: draftBase,
          })}
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          {t('detail.staleVersion.seeChanges', { latest })}
        </Link>
      </>
    );
  })();

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
        {(viewingOld ||
          refusal !== null ||
          deployRefusal !== null ||
          deployedReadError ||
          shownDeployNotice !== null ||
          newerVersion !== null) && (
          <div className="border-border flex flex-col gap-3 border-b p-4">
            {viewingOld && (
              <Alert
                variant="info"
                title={t('editor.oldVersion.title', {
                  version: lookingVersion,
                  latest: latestVersion,
                })}
                {...(draft !== null && {
                  description: t('editor.oldVersion.draft', {
                    next: latestVersion + 1,
                    version: lookingVersion,
                  }),
                })}
              >
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => requestVersionSwitch(latestVersion)}
                  >
                    {t('editor.oldVersion.showLatest', {
                      latest: latestVersion,
                    })}
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      {...compareVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version: latestVersion,
                        from: lookingVersion,
                      })}
                    >
                      {t('editor.oldVersion.compare', {
                        version: lookingVersion,
                        latest: latestVersion,
                      })}
                    </Link>
                  </Button>
                </div>
              </Alert>
            )}
            {newerVersion !== null && draftBase !== undefined && (
              <Alert
                variant="info"
                title={t('canvas.newerVersion.title')}
                description={
                  <>
                    {t('canvas.newerVersion.body', {
                      version: newerVersion,
                      base: draftBase,
                    })}
                    {meta !== undefined && meta !== null && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5">
                        <span>{t('canvas.newerVersion.savedBy')}</span>
                        <VersionAuthor
                          organizationId={organizationId}
                          layout="inline"
                          facts={{
                            actor: meta.createdBy,
                            via: meta.createdVia ?? null,
                            viaInferred: meta.viaInferred === true,
                            clientName: meta.clientName ?? null,
                          }}
                        />
                      </span>
                    )}
                    {newerChanges !== null && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5">
                        <span>{t('canvas.newerVersion.changes')}</span>
                        <ChangeSummary
                          aria-label={t('compare.summary.label')}
                          counts={{
                            added: newerChanges.nodes.added,
                            removed: newerChanges.nodes.removed,
                            changed: newerChanges.nodes.changed,
                            renamed: newerChanges.nodes.renamed ?? 0,
                          }}
                          flags={changeFlags(newerChanges, t)}
                        />
                      </span>
                    )}
                  </>
                }
              >
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={discardDraft}
                  >
                    {t('canvas.newerVersion.show', { version: newerVersion })}
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      {...compareVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version: newerVersion,
                        from: draftBase,
                      })}
                      target="_blank"
                      rel="noopener"
                    >
                      {t('canvas.newerVersion.seeChanges', {
                        version: newerVersion,
                      })}
                    </Link>
                  </Button>
                </div>
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
            {shownDeployNotice !== null && (
              <TriggerDeployNotice
                ref={deployNoticeRef}
                place={{ organizationId, projectId, name: automationSlug }}
                trigger={shownDeployNotice}
              />
            )}
          </div>
        )}

        <div
          ref={workbenchRef}
          className={cn(
            AUTOMATION_EDITOR_WORKBENCH_GRID,
            (inspected !== null || shownTest !== null) &&
              AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
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
                <>
                  {transientBanner}
                  <AutomationCanvas
                    automation={canvasDocument}
                    {...(tests.tests.length > 0 && { pathCoverage: coverage })}
                    pathsOpen={pathsOpen}
                    onPathsOpenChange={setPathsOpen}
                    layoutKey={layoutKey}
                    catalog={catalog}
                    modelLabel={modelLabel}
                    allowedWrites={allowedWrites}
                    triggers={triggerRowsShown}
                    check={canvasCheck}
                    startNotice={startNotice}
                    issueCounts={countsByNode}
                    selectedId={selectedId}
                    onSelect={selectOnCanvas}
                    revealId={selectedId}
                    inspectorId={inspectorId}
                    {...(canvasRun !== undefined && { run: canvasRun })}
                    {...(canvasChange !== undefined && {
                      changed: canvasChange,
                    })}
                    framed={false}
                    view={canvasView}
                    onViewChange={(next) =>
                      changeView(next === 'list' ? 'list' : 'canvas')
                    }
                    topStart={viewSwitch}
                    topEnd={
                      <>
                        {lastRun !== undefined || overlayRun !== null ? (
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
                </>
              )
            )}
            {/* Under the canvas, spanning its column only, so the inspector
                beside it keeps its full height. Below `lg` the list opens
                in a sheet instead (further down). */}
            {canAuthor && dockPanel !== null && !isWorkbenchCompact && (
              <AutomationDock
                id={problemsDockId}
                active={dockPanel}
                onActiveChange={(next) => {
                  setProblemsOpen(next === 'problems');
                  setTestsOpen(next === 'tests');
                }}
                onClose={closeDock}
                problems={{
                  listRef: problemsListRef,
                  items: issueItems,
                  counts: issueCounts,
                  status: issueStatus === 'idle' ? 'ready' : issueStatus,
                  activeId: activeIssueId,
                  onActivate: goToIssue,
                  filter: problemsFilter,
                  onFilterChange: setProblemsFilter,
                }}
                tests={testsPanel}
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
          {shownTest !== null && !isWorkbenchCompact && (
            <TestInspector id={inspectorId} {...testFields(shownTest)} />
          )}
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
      {canAuthor && isWorkbenchCompact && (
        <AutomationTestsSheet
          open={dockPanel === 'tests'}
          onOpenChange={(open) => {
            if (!open) setTestsOpen(false);
          }}
          handingOn={testsHandingOn}
          {...testsPanel}
        />
      )}
      {isWorkbenchCompact && (
        <ResponsiveDialog
          open={shownTest !== null}
          onOpenChange={(open) => {
            if (open) return;
            setSelectedTest(null);
            // Opened from the list's sheet, which is gone by now: the reader
            // returns to the Tests button.
            requestAnimationFrame(() => testsButtonRef.current?.focus());
          }}
        >
          <ResponsiveDialogContent
            // The test's own header has Close, as a node's sheet does.
            hideClose
            className="flex max-h-[85dvh] flex-col"
            preventCloseAutoFocus
          >
            {shownTest !== null && (
              <>
                <ResponsiveDialogTitle className="sr-only">
                  {tests.rows[shownTest]?.name}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="sr-only">
                  {t('tests.inspector.position', {
                    number: shownTest + 1,
                    total: tests.tests.length,
                  })}
                </ResponsiveDialogDescription>
                <TestFields
                  headingId={inspectorId}
                  {...testFields(shownTest)}
                />
              </>
            )}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
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
      {canAuthor && (
        <TestRunAnnouncer
          counts={tests.counts}
          status={tests.status}
          announceKey={tests.announceKey}
        />
      )}
      {/* What a change to the tests did that the list cannot show: a
          deleted test. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-slot="tests-announcer"
      >
        {testsNews.text === '' ? null : (
          <span key={testsNews.key}>{testsNews.text}</span>
        )}
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
        <div className="mb-4 flex flex-col gap-3">
          <Text variant="muted">
            {t('detail.saveDialog.creates', {
              next: newestVersion + 1,
              base: basedOnOlder ? draftBasedOn : 'none',
            })}
          </Text>
          {basedOnOlder && (
            <Alert
              variant="warning"
              description={
                <>
                  {t('detail.saveDialog.notIncluded', {
                    from: (draftBasedOn ?? 0) + 1,
                    to: newestVersion,
                    count: newestVersion - (draftBasedOn ?? 0),
                  })}{' '}
                  <Link
                    {...compareVersionLink({
                      organizationId,
                      automationSlug,
                      projectId,
                      version: newestVersion,
                      from: draftBasedOn,
                    })}
                    target="_blank"
                    rel="noopener"
                    className="underline underline-offset-2"
                  >
                    {t('editor.oldVersion.compare', {
                      version: draftBasedOn,
                      latest: newestVersion,
                    })}
                  </Link>
                </>
              }
            />
          )}
          {reviewDiff !== null && (
            <CollapsibleDetails
              variant="compact"
              summary={t('detail.saveDialog.review')}
            >
              <div className="flex flex-col gap-3 pt-2">
                <ChangeSummary
                  aria-label={t('compare.summary.label')}
                  counts={{
                    added: reviewDiff.counts.added,
                    removed: reviewDiff.counts.removed,
                    changed: reviewDiff.counts.changed,
                    renamed: reviewDiff.counts.renamed,
                  }}
                  flags={changeFlags(changeSummaryOf(reviewDiff), t)}
                />
                <VersionChanges sections={reviewSections} note={false} />
              </div>
            </CollapsibleDetails>
          )}
        </div>
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

      {rawDocument !== null && (
        <LlmModelSwapDialog
          open={modelSwapOpen}
          onOpenChange={setModelSwapOpen}
          organizationId={organizationId}
          document={rawDocument}
          onApply={swapModel}
        />
      )}

      {runRequest !== null && (
        <AutomationRunDialog
          request={runRequest}
          projects={projects}
          pending={startRun.isPending || tryRun.isPending}
          error={tryRefusal ?? refusal}
          onClose={() => {
            setRunRequest(null);
            setRefusal(null);
            setTryRefusal(null);
          }}
          onConfirm={(input, target) => confirmRun(runRequest, input, target)}
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
        description={staleDescription}
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
      <DeployRefusedDialog
        organizationId={organizationId}
        automationSlug={automationSlug}
        projectId={projectId}
        refusal={deployer.refusal}
        onClose={deployer.closeRefusal}
        openInEditor={false}
      />
    </>
  );
}
