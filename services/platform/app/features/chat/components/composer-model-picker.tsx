'use client';

/**
 * The model picker, plus the helpers that decide which model a turn runs.
 *
 * The chat page offers MODEL SELECTION ONLY (the Chat·Task·Automation
 * boundary): no harness group, no sandbox toggle, no agent rows.
 * `directServedModels` narrows the catalog to what a direct chat turn can
 * actually call — a subscription credential is bound to a vendor harness and
 * has no direct path — and `withDefaultModel` seeds a model the moment the
 * listing answers, so a turn sends without ever opening this menu.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { ChevronDown, Cpu } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import type { ModelCatalogEntry } from '@/lib/shared/schemas/providers';

import { resolveSandboxAffordance } from '../lib/composer-execution';
import type { ComposerModelOption, ComposerSelection } from '../types';

interface ComposerModelPickerProps {
  models: readonly ComposerModelOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}

/**
 * The picker only needs a model's identity to ask the resolver how it may
 * run; the catalog fields the resolver ignores are filled with neutral values
 * rather than invented ones.
 */
function asCatalogEntry(option: ComposerModelOption): ModelCatalogEntry {
  return {
    id: option.id,
    provider: option.providerSlug,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 1,
  };
}

/**
 * Seed the platform agent's model once the listing arrives: the user's saved
 * pick when it is still listed, else the first model whose credential leaves
 * execution free, else the first model at all. A model already picked in this
 * session is left untouched.
 */
export function withDefaultModel(
  selection: ComposerSelection,
  models: readonly ComposerModelOption[],
  preferredId?: string,
): ComposerSelection {
  if (selection.modelId !== undefined) return selection;
  const affordanceOf = (model: ComposerModelOption) =>
    resolveSandboxAffordance(asCatalogEntry(model), model.credential);
  const chosen =
    models.find((model) => model.id === preferredId) ??
    models.find((model) => !affordanceOf(model).locked) ??
    models[0];
  if (chosen === undefined) return selection;
  return {
    ...selection,
    modelId: chosen.id,
    providerSlug: chosen.providerSlug,
  };
}

/**
 * The models a direct chat turn can call: those a direct-capable
 * (api-key/env) credential serves. A subscription credential is bound to a
 * vendor harness and has no direct path, so its models never appear in the
 * chat picker.
 */
export function directServedModels(
  models: readonly ComposerModelOption[],
): ComposerModelOption[] {
  return models.filter(
    (model) =>
      !resolveSandboxAffordance(asCatalogEntry(model), model.credential).locked,
  );
}

export function ComposerModelPicker({
  models,
  selection,
  onSelectionChange,
  disabled,
}: ComposerModelPickerProps) {
  const { t } = useT('chat');

  // Prefer the exact (provider, id) pair; fall back to the id alone for a
  // selection saved before providers were part of the pick.
  const selectedModel =
    models.find(
      (model) =>
        model.id === selection.modelId &&
        model.providerSlug === selection.providerSlug,
    ) ?? models.find((model) => model.id === selection.modelId);

  const items = useMemo<DropdownMenuGroup[]>(() => {
    if (models.length === 0) return [];
    const providers = [...new Set(models.map((model) => model.providerSlug))];
    const itemOf = (model: ComposerModelOption) => ({
      type: 'item' as const,
      label: model.label,
      icon: Cpu,
      selected:
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
      onClick: () =>
        onSelectionChange({
          ...selection,
          modelId: model.id,
          providerSlug: model.providerSlug,
        }),
    });
    // Always one labelled section per provider — even a lone provider keeps
    // its header, so the two lanes read the same (the external lane often
    // narrows to a single provider's direct-served models, and its header
    // says exactly whose wire those are) and the same model id is findable —
    // and PICKABLE — under each provider that serves it.
    return providers.map((provider) => {
      const group: DropdownMenuGroup = [
        { type: 'label' as const, content: provider },
      ];
      for (const model of models) {
        if (model.providerSlug === provider) group.push(itemOf(model));
      }
      return group;
    });
  }, [models, selection, onSelectionChange]);

  // Nothing selected is not the same as nothing to select: with options on
  // offer the trigger invites a pick; "no models" is reserved for a truly
  // empty menu, so the label never claims an absence that isn't there.
  const triggerLabel =
    selectedModel?.label ??
    (models.length > 0
      ? t('modelSelector.label')
      : t('modelSelector.noModelsAvailable'));

  return (
    <DropdownMenu
      align="start"
      disabled={disabled || items.length === 0}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('modelSelector.label')}
          aria-haspopup="menu"
          className="max-w-56 min-w-0"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
