'use client';

/**
 * The model picker, plus the helpers that decide which model a turn runs.
 *
 * The platform agent runs a model directly; a third-party agent runs a
 * directly-served org model through the session gateway — both pick it here.
 * It lists ONLY models — where a turn runs is decided by the agent kind (see
 * {@link ComposerAgentPicker}), never here, so there is no harness group and
 * no sandbox toggle. `withDefaultModel` seeds a model the moment the listing
 * answers, so a turn sends without ever opening this menu; the external lane
 * narrows to `directServedModels` and falls back through
 * `resolveExternalModelId`, mirroring the backend.
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
 * toggled. A third-party agent always does; a platform model whose
 * credential binds it to a vendor's own tooling does too.
 */
export function resolveSelectionSandbox(
  selection: ComposerSelection,
  models: readonly ComposerModelOption[],
): boolean {
  if (selection.agentKind === 'external') return true;
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
  return {
    ...selection,
    modelId: chosen.id,
    providerSlug: chosen.providerSlug,
  };
}

/**
 * The models the managed external lane can run: those a direct-capable
 * (api-key/env) credential serves — the same filter the turn's kick applies
 * server-side for the gateway path.
 */
export function directServedModels(
  models: readonly ComposerModelOption[],
): ComposerModelOption[] {
  return models.filter(
    (model) =>
      !resolveSandboxAffordance(asCatalogEntry(model), model.credential).locked,
  );
}

/**
 * The models one HARNESS can run under the managed lane: everything a direct
 * credential serves, plus the vendor-subscription models bound to exactly
 * this harness — a Claude coding plan runs Claude Code, and still cannot run
 * codex. Mirrors the server's `resolveManagedModel` eligibility.
 */
export function modelsForHarness(
  models: readonly ComposerModelOption[],
  harness: string | undefined,
): ComposerModelOption[] {
  return models.filter((model) => {
    const auth = model.credential;
    if (auth.authMethod === 'api-key' || auth.authMethod === 'env') {
      return true;
    }
    return harness !== undefined && auth.constraints.harness === harness;
  });
}

/**
 * The model an external turn runs on: the explicit pick when the managed
 * lane can serve it, else the first direct-served model — the same fallback
 * the backend applies, so the picker never displays a model the turn would
 * not use.
 */
export function resolveExternalModelId(
  selection: ComposerSelection,
  models: readonly ComposerModelOption[],
): string | undefined {
  const eligible = modelsForHarness(models, selection.harness);
  const picked = eligible.find((model) => model.id === selection.modelId);
  // The fallback stays a DIRECT model: a subscription copy is an explicit
  // pick, never a silent default.
  return (picked ?? directServedModels(models)[0])?.id;
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
