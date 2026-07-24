'use client';

/**
 * The composer's model picker and its sandbox toggle.
 *
 * The menu carries two groups. "Models" lists the models a turn can call
 * directly; "Sandbox agents" lists the harnesses a turn can run inside. There
 * is no "auto" MENU ENTRY — every option names a concrete model — but the
 * surface seeds the selection with a default via `withDefaultModel`, so
 * sending works without a menu visit.
 *
 * The toggle beside the picker asks whether a model turn runs in a sandbox.
 * For most credentials that is a free choice. A subscription-flavored
 * credential is only usable by its vendor's own tooling, so the toggle locks
 * ON and names the harness it is bound to — the rule itself comes from
 * `resolveSandboxAffordance`, never from a condition written here.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import { Boxes, ChevronDown, Cpu } from 'lucide-react';
import { useMemo } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { useT } from '@/lib/i18n/client';
import type { ModelCatalogEntry } from '@/lib/shared/schemas/providers';

import { resolveSandboxAffordance } from '../lib/composer-execution';
import type {
  ComposerModelOption,
  ComposerSandboxAgentOption,
  ComposerSelection,
} from '../types';

interface ComposerModelPickerProps {
  models: readonly ComposerModelOption[];
  sandboxAgents: readonly ComposerSandboxAgentOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}

/**
 * The picker only needs a model's identity to ask the resolver how it may
 * run; the catalog fields the resolver ignores are filled with neutral
 * values rather than invented ones.
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
 * Seed the selection with a default model once the listing arrives: the first
 * model whose credential leaves execution free, or failing that the first
 * model at all (taking its forced sandbox with it). A selection the user
 * already made — model or sandbox agent — is returned untouched.
 */
export function withDefaultModel(
  selection: ComposerSelection,
  models: readonly ComposerModelOption[],
): ComposerSelection {
  if (selection.modelId !== undefined || selection.harness !== undefined) {
    return selection;
  }
  const affordanceOf = (model: ComposerModelOption) =>
    resolveSandboxAffordance(asCatalogEntry(model), model.credential);
  const chosen =
    models.find((model) => !affordanceOf(model).locked) ?? models[0];
  if (chosen === undefined) return selection;
  return {
    ...selection,
    modelId: chosen.id,
    sandbox: affordanceOf(chosen).locked || selection.sandbox,
  };
}

export function ComposerModelPicker({
  models,
  sandboxAgents,
  selection,
  onSelectionChange,
  disabled,
}: ComposerModelPickerProps) {
  const { t } = useT('chat');

  const selectedModel = models.find((model) => model.id === selection.modelId);
  const selectedAgent = sandboxAgents.find(
    (agent) => agent.harness === selection.harness,
  );

  const affordance = useMemo(
    () =>
      selectedModel
        ? resolveSandboxAffordance(
            asCatalogEntry(selectedModel),
            selectedModel.credential,
          )
        : { locked: false },
    [selectedModel],
  );

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [];

    if (models.length > 0) {
      groups.push([
        { type: 'label', content: t('modelSelector.sectionModels') },
        ...models.map((model) => ({
          type: 'item' as const,
          label: model.label,
          icon: Cpu,
          selected: model.id === selection.modelId,
          onClick: () =>
            onSelectionChange({
              ...selection,
              modelId: model.id,
              harness: undefined,
              // A credential that forces a sandbox takes the toggle with it.
              sandbox:
                resolveSandboxAffordance(
                  asCatalogEntry(model),
                  model.credential,
                ).locked || selection.sandbox,
            }),
        })),
      ]);
    }

    if (sandboxAgents.length > 0) {
      groups.push([
        { type: 'label', content: t('modelSelector.sectionSandboxAgents') },
        ...sandboxAgents.map((agent) => ({
          type: 'item' as const,
          label: agent.label,
          icon: Boxes,
          selected: agent.harness === selection.harness,
          onClick: () =>
            onSelectionChange({
              ...selection,
              modelId: undefined,
              harness: agent.harness,
              // Picking a sandbox agent IS choosing the sandbox.
              sandbox: true,
            }),
        })),
      ]);
    }

    return groups;
  }, [models, sandboxAgents, selection, onSelectionChange, t]);

  // Nothing selected is not the same as nothing to select: with options on
  // offer the trigger invites a pick; "no models" is reserved for a truly
  // empty menu, so the label never claims an absence that isn't there.
  const triggerLabel =
    selectedModel?.label ??
    selectedAgent?.label ??
    (items.length > 0
      ? t('modelSelector.label')
      : t('modelSelector.noModelsAvailable'));

  // A sandbox agent has no toggle: it is already the sandbox. A model shows
  // one, locked when its credential leaves no choice.
  const showToggle = selection.harness === undefined;
  const lockedHarness = affordance.harness;

  return (
    <Row gap={2} align="center" className="min-w-0">
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
      {showToggle && (
        <Switch
          label={t('composerSandbox.label')}
          description={
            affordance.locked && lockedHarness
              ? t('composerSandbox.lockedByCredential', {
                  harness: lockedHarness,
                })
              : undefined
          }
          checked={affordance.locked || selection.sandbox}
          disabled={disabled || affordance.locked}
          onCheckedChange={(next) =>
            onSelectionChange({ ...selection, sandbox: next })
          }
        />
      )}
    </Row>
  );
}
