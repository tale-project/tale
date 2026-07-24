'use client';

/**
 * The platform agent's model override.
 *
 * The platform agent runs a model directly; this picker is how the user
 * changes which one. It lists ONLY models — where a turn runs is decided by
 * the agent kind (see {@link ComposerAgentPicker}), never here, so there is no
 * harness group and no sandbox toggle. `withDefaultModel` seeds a model the
 * moment the listing answers, so a turn sends without ever opening this menu.
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
 * Whether the current selection must run in a sandbox — derived, never
 * toggled. A third-party coding agent always does; a platform model whose
 * credential binds it to a vendor's own tooling does too.
 */
export function resolveSelectionSandbox(
  selection: ComposerSelection,
  models: readonly ComposerModelOption[],
): boolean {
  if (selection.agentKind === 'coding') return true;
  const model = models.find((candidate) => candidate.id === selection.modelId);
  return model
    ? resolveSandboxAffordance(asCatalogEntry(model), model.credential).locked
    : false;
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
  return { ...selection, modelId: chosen.id };
}

export function ComposerModelPicker({
  models,
  selection,
  onSelectionChange,
  disabled,
}: ComposerModelPickerProps) {
  const { t } = useT('chat');

  const selectedModel = models.find((model) => model.id === selection.modelId);

  const items = useMemo<DropdownMenuGroup[]>(() => {
    if (models.length === 0) return [];
    return [
      models.map((model) => ({
        type: 'item' as const,
        label: model.label,
        icon: Cpu,
        selected: model.id === selection.modelId,
        onClick: () => onSelectionChange({ ...selection, modelId: model.id }),
      })),
    ];
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
