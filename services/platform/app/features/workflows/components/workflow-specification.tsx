'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { AlertTriangle, Info, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { useRegisterActiveEditor } from '@/app/components/ui/editor';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';
import { cn } from '@/lib/utils/cn';

import { useSaveWorkflow } from '../hooks/file-mutations';
import { useReadWorkflow } from '../hooks/file-queries';
import {
  useGenerateGraphFromSpecification,
  useGenerateSpecificationFromGraph,
} from '../hooks/specification-actions';
import { useWorkflowSpecificationValidation } from '../hooks/use-workflow-specification-validation';
import { ValidationMessages } from './validation-messages';
import { WorkflowDiffDialog } from './workflow-diff-dialog';

interface WorkflowSpecificationProps {
  organizationId: string;
  workflowSlug: string;
  className?: string;
}

interface SyncedDraft {
  text: string;
  sourceHash: string;
}

// A specification draft lives in this component's local state, but the parent's
// Graph⇄Specification toggle renders the two views as ternary branches, so
// switching unmounts this component. Persist the in-progress draft per workflow
// across that unmount so a casual toggle never silently discards unsaved text.
// The cache is write-through (updated wherever the draft is set) and re-read on
// remount; after a save it already equals the file's specification, so nothing
// reads a stale value.
const draftCache = new Map<string, string>();
const draftCacheKey = (organizationId: string, workflowSlug: string): string =>
  `${organizationId}:${workflowSlug}`;

/**
 * The workflow's SPECIFICATION — its only prose (a workflow carries no name
 * or description): a full-height markdown text editor. Context-free (no
 * `WorkflowConfigProvider`) — like `WorkflowAIChatPanel`, it reads and saves
 * the workflow definition directly so it can drop into the automation
 * detail's Editor tab without a shared ancestor.
 *
 * Saving goes through the page's SHARED Save cluster: the component registers
 * itself as the active editor (`useRegisterActiveEditor`), so Save/Discard
 * render in the tab strip like every other settings form. There is no
 * standing "Regenerate" button — regeneration is offered exactly when it
 * makes sense, on the sync banners:
 *
 *  - `spec_stale` (the graph moved) → "Update from graph" refreshes the draft
 *    from the current graph (`previewSpecificationFromGraph`); saving then
 *    records the fresh sync.
 *  - `graph_stale` (the spec moved) → "Regenerate graph" previews a new graph
 *    from the spec (`previewGraphFromSpecification`) behind a diff dialog;
 *    applying commits both sides in sync.
 *
 * A plain save sends the config through `saveWorkflowWithSnapshot`, whose
 * server-side reconcile keeps `specificationMeta` honest (an author-shipped
 * pair diverging for the first time gets its baseline stamped there).
 */
export function WorkflowSpecification({
  organizationId,
  workflowSlug,
  className,
}: WorkflowSpecificationProps) {
  const { t } = useT('workflows');
  const {
    data: readResult,
    isLoading,
    refetch,
  } = useReadWorkflow(organizationId, workflowSlug);
  const config: WorkflowJsonConfig | undefined =
    readResult && readResult.ok ? readResult.config : undefined;
  const hash: string | undefined =
    readResult && readResult.ok ? readResult.hash : undefined;
  const specSyncStatus: string | undefined =
    readResult && readResult.ok ? readResult.specSyncStatus : undefined;

  const saveWorkflow = useSaveWorkflow();
  const generateGraph = useGenerateGraphFromSpecification();
  const generateSpecification = useGenerateSpecificationFromGraph();

  const cacheKey = draftCacheKey(organizationId, workflowSlug);
  const [draft, setDraftRaw] = useState(
    () => draftCache.get(cacheKey) ?? config?.specification ?? '',
  );
  // Write-through so the draft survives the unmount on a Graph⇄Specification
  // toggle; every draft mutation goes through this.
  const setDraft = useCallback(
    (value: string) => {
      setDraftRaw(value);
      draftCache.set(draftCacheKey(organizationId, workflowSlug), value);
    },
    [organizationId, workflowSlug],
  );
  const [syncedFrom, setSyncedFrom] = useState<SyncedDraft | null>(null);
  // Reset the draft only when switching workflows — NOT on every config
  // refetch, so an unrelated cache refresh (e.g. after our own save) never
  // clobbers in-progress edits. Compared in-render like `JsonInput`'s
  // `prevValueRef`, since a `useEffect` here would still fire one render
  // late.
  const prevSlugRef = useRef(workflowSlug);
  if (prevSlugRef.current !== workflowSlug) {
    prevSlugRef.current = workflowSlug;
    // Restore any preserved draft for the workflow we switched to, else the
    // file's saved specification.
    setDraftRaw(draftCache.get(cacheKey) ?? config?.specification ?? '');
    setSyncedFrom(null);
  }

  const [graphErrors, setGraphErrors] = useState<string[]>([]);
  const [graphWarnings, setGraphWarnings] = useState<string[]>([]);
  const [candidateConfig, setCandidateConfig] =
    useState<WorkflowJsonConfig | null>(null);
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  const isDirty = draft !== (config?.specification ?? '');

  // The exact value `handleSave` would persist (see its `trimmed ? liveDraft
  // : undefined`) — mirrored here so a would-be-invalid draft that trims down
  // to something valid never false-positives the gate below.
  const trimmedDraft = draft.trim();
  const specificationCandidate: WorkflowJsonConfig | undefined = config
    ? { ...config, specification: trimmedDraft ? draft : undefined }
    : undefined;
  // Real client-side validity — the same `workflowJsonSchema` the server's
  // `saveWorkflow` enforces, so Save disables instead of round-tripping to a
  // guaranteed VALIDATION_ERROR once the draft exceeds the 20,000-character
  // ceiling (#2665).
  const specificationValidation = useWorkflowSpecificationValidation(
    specificationCandidate,
  );
  const specificationErrorId = useId();

  // The registered controller re-registers only on STATE flips (isDirty …),
  // not per keystroke — so `save`/`reset` must read the live values through a
  // ref rather than their closures (the same reason `useFormEditor` reads
  // RHF's external store at save time).
  const liveRef = useRef({ draft, syncedFrom, config, hash });
  liveRef.current = { draft, syncedFrom, config, hash };

  const handleSave = useCallback(async () => {
    const {
      draft: liveDraft,
      syncedFrom: liveSyncedFrom,
      config: liveConfig,
      hash: liveHash,
    } = liveRef.current;
    if (!liveConfig || liveHash === undefined) return;
    const trimmed = liveDraft.trim();
    // A draft that still matches a just-run "Update from graph" records that
    // fresh sync; any other save carries the stored record and lets the
    // server-side reconcile keep it honest.
    const specificationMeta =
      trimmed && liveSyncedFrom && liveSyncedFrom.text === liveDraft
        ? {
            sourceHash: liveSyncedFrom.sourceHash,
            generatedAt: Date.now(),
            direction: 'graph_to_spec' as const,
          }
        : liveConfig.specificationMeta;

    try {
      await saveWorkflow.mutateAsync({
        organizationId,
        workflowSlug,
        config: {
          ...liveConfig,
          specification: trimmed ? liveDraft : undefined,
          specificationMeta,
        },
        expectedHash: liveHash,
      });
      toast({ title: t('editorView.saveSuccess'), variant: 'success' });
      await refetch();
    } catch (error) {
      console.error('[WorkflowSpecification] save failed:', error);
      toast({ title: t('editorView.saveFailed'), variant: 'destructive' });
      throw error;
    }
  }, [saveWorkflow, organizationId, workflowSlug, refetch, t]);

  const handleDiscard = useCallback(() => {
    setDraft(liveRef.current.config?.specification ?? '');
    setSyncedFrom(null);
  }, [setDraft]);

  // The page's shared Save/Discard cluster (tab strip) drives this editor —
  // the same active-editor contract every settings form implements.
  const controller = useMemo(
    () => ({
      isDirty,
      isSaving: saveWorkflow.isPending,
      isValid: specificationValidation.isValid,
      isLoading,
      dirtyKeys: isDirty
        ? new Set<string>(['specification'])
        : new Set<string>(),
      save: handleSave,
      reset: handleDiscard,
    }),
    [
      isDirty,
      saveWorkflow.isPending,
      specificationValidation.isValid,
      isLoading,
      handleSave,
      handleDiscard,
    ],
  );
  useRegisterActiveEditor(controller);

  const handleRegenerateGraph = useCallback(async () => {
    setGraphErrors([]);
    setGraphWarnings([]);
    try {
      const result = await generateGraph.mutateAsync({
        organizationId,
        workflowSlug,
        specification: draft,
      });
      if (result.ok) {
        setCandidateConfig(result.config);
        setGraphWarnings(result.warnings ?? []);
        setIsDiffOpen(true);
      } else {
        setGraphErrors(result.errors);
        setGraphWarnings(result.warnings ?? []);
      }
    } catch (error) {
      console.error(
        '[WorkflowSpecification] previewGraphFromSpecification failed:',
        error,
      );
      toast({ title: t('editorView.generateError'), variant: 'destructive' });
    }
  }, [generateGraph, organizationId, workflowSlug, draft, t]);

  const handleConfirmApplyGraph = useCallback(async () => {
    if (!candidateConfig || hash === undefined) return;
    try {
      await saveWorkflow.mutateAsync({
        organizationId,
        workflowSlug,
        config: candidateConfig,
        expectedHash: hash,
      });
      setIsDiffOpen(false);
      setCandidateConfig(null);
      toast({ title: t('editorView.saveSuccess'), variant: 'success' });
      await refetch();
    } catch (error) {
      console.error('[WorkflowSpecification] apply graph failed:', error);
      toast({ title: t('editorView.saveFailed'), variant: 'destructive' });
    }
  }, [
    candidateConfig,
    hash,
    saveWorkflow,
    organizationId,
    workflowSlug,
    refetch,
    t,
  ]);

  const handleUpdateFromGraph = useCallback(async () => {
    try {
      const result = await generateSpecification.mutateAsync({
        organizationId,
        workflowSlug,
      });
      setDraft(result.specification);
      setSyncedFrom({
        text: result.specification,
        sourceHash: result.sourceHash,
      });
    } catch (error) {
      console.error(
        '[WorkflowSpecification] previewSpecificationFromGraph failed:',
        error,
      );
      toast({ title: t('editorView.generateError'), variant: 'destructive' });
    }
  }, [generateSpecification, organizationId, workflowSlug, setDraft, t]);

  if (isLoading) {
    return (
      <Skeletonize loading className={cn('contents', className)}>
        <SkeletonText lines={10} />
      </Skeletonize>
    );
  }

  // Both call sites only mount this component once their own read of the
  // same workflow already resolved `ok` — this is a defensive fallback for
  // the (rare) race where the file disappears between that check and this
  // component's own independent `useReadWorkflow` call.
  if (!config) {
    return null;
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3 p-4', className)}>
      {specSyncStatus === 'spec_stale' && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          title={t('editorView.specStaleBanner')}
        >
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            className="mt-2"
            disabled={generateSpecification.isPending}
            onClick={() => void handleUpdateFromGraph()}
          >
            {t('editorView.updateFromGraph')}
          </Button>
        </Alert>
      )}
      {specSyncStatus === 'graph_stale' && (
        <Alert
          variant="info"
          icon={Info}
          title={t('editorView.graphStaleBanner')}
        >
          <Button
            size="sm"
            variant="secondary"
            icon={Sparkles}
            className="mt-2"
            disabled={!draft.trim() || generateGraph.isPending}
            onClick={() => void handleRegenerateGraph()}
          >
            {t('editorView.regenerateGraph')}
          </Button>
        </Alert>
      )}

      {/* The editor fills the page; the floating mode toggle overlays its
          bottom-center, so the bottom padding keeps text clear of it. */}
      <textarea
        aria-label={t('editorView.specification')}
        aria-invalid={!specificationValidation.isValid || undefined}
        aria-describedby={
          specificationValidation.fieldErrors.specification
            ? specificationErrorId
            : undefined
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('editorView.placeholder')}
        spellCheck={false}
        className={cn(
          'border-input bg-background text-foreground placeholder:text-muted-foreground',
          'focus-visible:ring-ring min-h-64 w-full flex-1 resize-none rounded-lg border',
          'p-4 pb-16 font-mono text-base leading-relaxed focus-visible:ring-2 focus-visible:outline-none md:text-sm',
          !specificationValidation.isValid &&
            'border-destructive focus-visible:ring-destructive',
        )}
      />

      {specificationValidation.fieldErrors.specification && (
        <p
          id={specificationErrorId}
          role="alert"
          aria-live="polite"
          className="text-destructive flex items-center gap-1.5 text-sm"
        >
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {specificationValidation.fieldErrors.specification}
        </p>
      )}

      {!draft.trim() && (
        <div className="flex items-center justify-between gap-3">
          <Text variant="muted" className="text-sm">
            {t('editorView.emptyState')}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            disabled={generateSpecification.isPending}
            onClick={() => void handleUpdateFromGraph()}
          >
            {t('editorView.generateFromGraph')}
          </Button>
        </div>
      )}

      <ValidationMessages
        errors={graphErrors}
        warnings={graphWarnings}
        errorLabel={t('editorView.validationErrors')}
        warningLabel={t('sidePanel.validationWarnings')}
      />

      {candidateConfig && (
        <WorkflowDiffDialog
          open={isDiffOpen}
          onOpenChange={setIsDiffOpen}
          currentConfig={config}
          candidateConfig={candidateConfig}
          title={t('editorView.diffTitle')}
          description={t('editorView.diffDescription')}
          confirmLabel={t('editorView.applyGraph')}
          confirmVariant="primary"
          isConfirming={saveWorkflow.isPending}
          onConfirm={() => void handleConfirmApplyGraph()}
        />
      )}
    </div>
  );
}
