'use client';

/**
 * Use another model in every `llm` step that names one model — for a
 * document whose model the organization does not serve (a shipped pack
 * naming a model no connected provider offers), or a switch to a cheaper or
 * stronger one. It edits the draft like any field edit, so the Save and
 * Discard cluster keeps the change reviewable; nothing is saved here.
 *
 * With lists the models the composer roster serves; a read of it that failed
 * is named under With with Try again, never "No models found", and Use this
 * model says why it stays off (#4765).
 */

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useId, useMemo, useState } from 'react';

import {
  llmModelSteps,
  type LlmModelStep,
} from '@/lib/automations/model-defaults';
import { useT } from '@/lib/i18n/client';

import { useLlmModelOptions } from '../hooks/use-llm-model-options';
import type { RawDocument } from '../lib/draft-document';
import { nodeTitle } from '../lib/node-face';

export function LlmModelSwapDialog({
  open,
  onOpenChange,
  organizationId,
  // Named apart from the page's `document`, which the focus hand-off reads.
  document: rawDocument,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The document on screen — the draft when there is one. */
  document: RawDocument;
  /** Replace `from` with `to` in every `llm` step that names `from`. */
  onApply: (from: string, to: string) => void;
}) {
  const { t } = useT('automations');
  const { t: tProjects } = useT('projects');
  const id = useId();
  const toId = `${id}-to`;
  const { options, loaded, unavailable, retrying, failureCount, retry } =
    useLlmModelOptions(organizationId);
  const byModel = useMemo(() => {
    const groups = new Map<string, LlmModelStep[]>();
    for (const step of llmModelSteps(rawDocument)) {
      groups.set(step.model, [...(groups.get(step.model) ?? []), step]);
    }
    return groups;
  }, [rawDocument]);
  const models = [...byModel.keys()];
  const [picked, setPicked] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const from = picked !== null && byModel.has(picked) ? picked : models[0];
  const steps = from === undefined ? [] : (byModel.get(from) ?? []);
  const choices = options.filter((option) => option.value !== from);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTo(null);
        onOpenChange(next);
      }}
    >
      <ResponsiveDialogContent className="flex flex-col gap-4">
        <ResponsiveDialogTitle>
          {t('editor.modelSwap.title')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('editor.modelSwap.description')}
        </ResponsiveDialogDescription>
        <Select
          id={`${id}-from`}
          label={t('editor.modelSwap.from')}
          options={models.map((model) => ({
            value: model,
            label: t('editor.modelSwap.fromOption', {
              model,
              count: byModel.get(model)?.length ?? 0,
            }),
          }))}
          value={from ?? ''}
          onValueChange={(value) => {
            // Radix fires a spurious '' on unmount — never act on it.
            if (value === '') return;
            setPicked(value);
            setTo(null);
          }}
        />
        <Skeletonize loading={!loaded && !unavailable}>
          <SearchableSelect
            id={toId}
            label={t('editor.modelSwap.to')}
            placeholder={t('editor.llm.modelPlaceholder')}
            searchPlaceholder={tProjects('agents.modelSearchPlaceholder')}
            emptyText={tProjects('agents.modelSearchEmpty')}
            options={choices}
            // Nothing to choose from until the roster answers.
            disabled={!loaded}
            value={to}
            onValueChange={(value) => {
              if (value === '') return;
              setTo(value);
            }}
          />
        </Skeletonize>
        {unavailable && (
          <CatalogLoadError
            message={t('editor.llm.modelsLoadFailed')}
            failureKey={failureCount}
            isRetrying={retrying}
            onRetry={retry}
            // A retry that brings the models takes the alert away: the focus
            // it held goes to With, not the dialog.
            onFocusLost={() => document.getElementById(toId)?.focus()}
          />
        )}
        <div>
          <Text as="h3" variant="label" id={`${id}-steps`}>
            {t('editor.modelSwap.steps')}
          </Text>
          <ul
            aria-labelledby={`${id}-steps`}
            className="mt-1 flex flex-col gap-1"
          >
            {steps.map((step) => (
              <li key={step.nodeId} className="text-sm">
                {nodeTitle(step.nodeId)}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('editor.modelSwap.cancel')}
          </Button>
          <Button
            disabled={from === undefined || to === null}
            disabledReason={
              unavailable ? t('editor.llm.modelsLoadFailed') : undefined
            }
            onClick={() => {
              if (from === undefined || to === null) return;
              onApply(from, to);
              setTo(null);
              onOpenChange(false);
            }}
          >
            {t('editor.modelSwap.apply')}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
