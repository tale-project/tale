'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { AlertTriangle, Info, RefreshCw, Save, Sparkles } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
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
// Graph⇄Specification pill toggle renders the two views as ternary branches, so
// switching unmounts this component. Persist the in-progress draft per workflow
// across that unmount so a casual toggle never silently discards unsaved text.
// The cache is write-through (updated wherever the draft is set) and re-read on
// remount; after a save it already equals the file's specification, so nothing
// reads a stale value.
const draftCache = new Map<string, string>();
const draftCacheKey = (organizationId: string, workflowSlug: string): string =>
  `${organizationId}:${workflowSlug}`;

/**
 * Text ⇄ graph dual-view editor's text side (W5b). Context-free (no
 * `WorkflowConfigProvider`) — like `WorkflowAIChatPanel`, it reads and saves
 * the workflow file directly so it can drop into either the standalone
 * `/workflows/$workflowId` editor or the automation detail's Editor tab
 * without a shared ancestor.
 *
 * Both LLM actions (`previewGraphFromSpecification`,
 * `previewSpecificationFromGraph`) are preview-only; this component owns the
 * only write path, via the same `saveWorkflowWithSnapshot` (compare-and-swap
 * on `expectedHash`) every other workflow editor surface uses. A plain text
 * save (the Save button) clears `specificationMeta` — it's no longer known
 * to be in sync with anything. A save right after "Regenerate specification"
 * (the draft still matches what that action returned) instead records the
 * fresh sync, so the banner reads `synced`, not `never_synced`.
 */
export function WorkflowSpecification({
  organizationId,
  workflowSlug,
  className,
}: WorkflowSpecificationProps) {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
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

  const handleSave = useCallback(async () => {
    if (!config || hash === undefined) return;
    const trimmed = draft.trim();
    const specificationMeta =
      trimmed && syncedFrom && syncedFrom.text === draft
        ? {
            sourceHash: syncedFrom.sourceHash,
            generatedAt: Date.now(),
            direction: 'graph_to_spec' as const,
          }
        : undefined;

    try {
      await saveWorkflow.mutateAsync({
        organizationId,
        workflowSlug,
        config: {
          ...config,
          specification: trimmed ? draft : undefined,
          specificationMeta,
        },
        expectedHash: hash,
      });
      toast({ title: t('editorView.saveSuccess'), variant: 'success' });
      await refetch();
    } catch (error) {
      console.error('[WorkflowSpecification] save failed:', error);
      toast({ title: t('editorView.saveFailed'), variant: 'destructive' });
    }
  }, [
    config,
    hash,
    draft,
    syncedFrom,
    saveWorkflow,
    organizationId,
    workflowSlug,
    refetch,
    t,
  ]);

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

  const handleRegenerateSpecification = useCallback(async () => {
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
    <VStack
      gap={3}
      className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)}
    >
      {specSyncStatus === 'stale' && (
        <Alert
          variant="warning"
          icon={AlertTriangle}
          title={t('editorView.staleBanner')}
        />
      )}
      {specSyncStatus === 'never_synced' && (
        <Alert
          variant="info"
          icon={Info}
          title={t('editorView.neverSyncedBanner')}
        />
      )}

      <Textarea
        label={t('editorView.specification')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('editorView.placeholder')}
        rows={20}
        className="min-h-96 font-mono text-xs leading-relaxed"
      />

      {!draft && (
        <Text variant="muted" className="text-sm">
          {t('editorView.emptyState')}
        </Text>
      )}

      <ValidationMessages
        errors={graphErrors}
        warnings={graphWarnings}
        errorLabel={t('editorView.validationErrors')}
        warningLabel={t('sidePanel.validationWarnings')}
      />

      <HStack gap={2} className="flex-wrap">
        <Button
          onClick={() => void handleSave()}
          disabled={!isDirty || saveWorkflow.isPending}
          icon={Save}
        >
          {saveWorkflow.isPending
            ? t('sidePanel.saving')
            : tCommon('actions.save')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleRegenerateGraph()}
          disabled={!draft.trim() || generateGraph.isPending}
          icon={Sparkles}
        >
          {t('editorView.regenerateGraph')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleRegenerateSpecification()}
          disabled={generateSpecification.isPending}
          icon={RefreshCw}
        >
          {config.specification
            ? t('editorView.regenerateSpecification')
            : t('editorView.generateFromGraph')}
        </Button>
      </HStack>

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
    </VStack>
  );
}
