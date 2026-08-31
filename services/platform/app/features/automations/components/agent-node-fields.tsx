'use client';

/**
 * The agent node's equipment, edited on the canvas with the SAME friendly
 * pickers the project-agent dialog uses — a harness Select, the (provider,
 * model) picker, the skills/connectors/tools menu, and the secrets manager —
 * instead of the raw JSON boxes the generic node inspector falls back to.
 * The model pick stores the PAIR (`model` + `modelProvider`), so the run is
 * served — and billed — by exactly the provider on screen instead of
 * whichever connector a walk reaches first. The node stores skills/
 * connectors/tools/secrets as flat string arrays; this component reads them
 * into the pickers and patches each field back on change (empty → removed,
 * so the document stays clean).
 */

import { Stack } from '@tale/ui/layout';
import { useMemo } from 'react';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { AgentSecretsField } from '@/app/features/projects/components/agent-secrets-field';
import {
  useAgentSecrets,
  useProjectHarnesses,
} from '@/app/features/projects/hooks/queries';
import { useUnpinnedServingPreview } from '@/app/features/projects/hooks/use-unpinned-serving-preview';
import {
  findSelectedModel,
  toModelOptions,
} from '@/app/features/projects/lib/model-options';
import { AGENT_TOOL_CATALOG } from '@/convex/sandbox/tool_names';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { useAutomationCapabilities } from '../hooks/queries';

/** Sentinel for the harness Select's "default" choice — Radix Select items
 * cannot carry an empty-string value, so an unset harness maps to this. */
const HARNESS_DEFAULT = '__default__';

/** The harness the workflow host runs when the node names none — mirrors
 * `convex/automations/agent_host.ts` `DEFAULT_HARNESS` (a 'use node' module
 * the browser bundle cannot import); the "Default (Claude Code)" label above
 * the picker states the same fact. Exported for the blank-automation wizard,
 * whose scaffolded node never names a harness. */
export const DEFAULT_HARNESS = 'claude-code';

/** The node fields this component owns — the inspector must NOT also render
 * them through its generic field loop. */
export const AGENT_EQUIPMENT_FIELDS: readonly string[] = [
  'model',
  'modelProvider',
  'harness',
  'skills',
  'connectors',
  'tools',
  'secrets',
];

function readStringArray(node: NodeDef, field: string): string[] {
  const record: Record<string, unknown> = { ...node };
  const value = record[field];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Empty arrays are dropped so the stored document stays free of `[]` noise. */
function emptyToUndef(values: readonly string[]): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

export function AgentNodeFields({
  organizationId,
  projectId,
  node,
  readOnly,
  onChange,
}: {
  organizationId: string;
  projectId?: string;
  node: NodeDef;
  readOnly: boolean;
  onChange: (patch: Partial<NodeDef>) => void;
}) {
  const { t } = useT('automations');
  const { t: tProjects } = useT('projects');
  const roster = useProjectHarnesses(organizationId);
  const capabilities = useAutomationCapabilities(
    organizationId,
    projectId,
    true,
  );
  const { data: orgSecrets } = useAgentSecrets(organizationId);

  // Radix forbids an <Item value="">, so the "use the default harness" choice
  // rides a sentinel that maps back to `undefined` on the node.
  const harnessOptions = useMemo(
    () => [
      { value: HARNESS_DEFAULT, label: t('editor.agent.harnessDefault') },
      ...(roster.data?.harnesses ?? []).map((h) => ({
        value: h.harness,
        label: h.label,
      })),
    ],
    [roster.data, t],
  );

  const toolOptions = useMemo<SkillOption[]>(
    () =>
      AGENT_TOOL_CATALOG.map((tool) => ({
        slug: tool.name,
        label: tProjects(`agents.tool.${tool.name}`, {
          defaultValue: tool.name,
        }),
        description: tProjects(
          tool.effect === 'write'
            ? 'agents.tool.writeBadge'
            : 'agents.tool.readBadge',
        ),
        group: tProjects(`agents.tool.module.${tool.module}`),
      })),
    [tProjects],
  );

  const binding: SkillsSelection = {
    skills: readStringArray(node, 'skills'),
    connectors: readStringArray(node, 'connectors'),
    tools: readStringArray(node, 'tools'),
  };
  const harnessRaw: Record<string, unknown> = { ...node };
  const harness =
    typeof harnessRaw.harness === 'string' ? harnessRaw.harness : '';
  const model = node.model ?? '';
  const modelProvider = node.modelProvider ?? '';

  const models = useMemo(
    () => toModelOptions(roster.data?.models ?? []),
    [roster.data],
  );
  // Subscription-served entries are bound to their forced harness — offer
  // them only when the node's EFFECTIVE harness (the host default when the
  // field is unset) is that one. Direct-served entries fit every harness.
  const effectiveHarness = harness === '' ? DEFAULT_HARNESS : harness;
  const offeredModels = useMemo(
    () =>
      models.filter(
        (option) =>
          option.subscription === undefined ||
          option.subscription.harness === effectiveHarness,
      ),
    [models, effectiveHarness],
  );
  const selectedModel = findSelectedModel(offeredModels, model, modelProvider);
  // Only claim "not offered" once the listing has answered — an empty roster
  // while it loads is not a missing model. Pinned picks only: a pinless pick
  // is not missing, it is unresolved, and gets the preview treatment below.
  const modelUnlisted =
    roster.data !== undefined &&
    model !== '' &&
    modelProvider !== '' &&
    selectedModel === undefined;
  // A pick saved before providers were part of it names a model but no
  // provider — the run's walk decides at kick time. Show what that walk
  // would pick RIGHT NOW (the runtime's own resolver answers, so display
  // and run cannot drift), never a lookalike row matched by id alone.
  const unpinnedModel = model !== '' && modelProvider === '';
  const preview = useUnpinnedServingPreview(
    'workflow',
    unpinnedModel
      ? { organizationId, model, harness: effectiveHarness }
      : undefined,
  );
  const resolved = preview.data;
  const resolvedRow =
    unpinnedModel && resolved?.ok === true
      ? offeredModels.find(
          (option) =>
            option.providerSlug === resolved.providerSlug &&
            option.id === resolved.modelId,
        )
      : undefined;
  // What the trigger displays: the pinned pair, or the row runs would use.
  const displayedModel = selectedModel ?? resolvedRow;
  const unpinnedDescription = !unpinnedModel
    ? undefined
    : resolved === undefined
      ? tProjects('agents.modelUnpinnedResolving', { model })
      : resolved.ok
        ? tProjects('agents.modelUnpinnedResolved', {
            model,
            provider: resolvedRow?.providerLabel ?? resolved.providerSlug,
          })
        : tProjects('agents.modelUnpinnedUnserved', {
            model,
            reason: resolved.reason,
          });
  const modelOptions = useMemo(
    () =>
      offeredModels.map((option, index) => ({
        // Index-keyed: model ids carry `/` and `:`, so no composed string
        // value can safely encode the (provider, id) pair.
        value: String(index),
        label: option.label,
        description:
          option.subscription === undefined
            ? option.providerLabel
            : tProjects('agents.modelProviderSubscription', {
                provider: option.providerLabel,
              }),
      })),
    [offeredModels, tProjects],
  );

  return (
    <Stack gap={3}>
      <Select
        id="automation-agent-harness"
        label={t('editor.fields.harness')}
        placeholder={t('editor.agent.harnessDefault')}
        options={harnessOptions}
        value={harness === '' ? HARNESS_DEFAULT : harness}
        disabled={readOnly}
        onValueChange={(value) => {
          // Radix fires a spurious '' on unmount — never act on it.
          if (value === '') return;
          const nextHarness = value === HARNESS_DEFAULT ? undefined : value;
          // A subscription-served model pick is bound to its harness; a
          // switch that invalidates it clears the pick rather than saving
          // a pair the run would refuse — the author re-picks from what
          // the new harness offers.
          const selected = findSelectedModel(models, model, modelProvider);
          const invalidated =
            selected?.subscription !== undefined &&
            selected.subscription.harness !== (nextHarness ?? DEFAULT_HARNESS);
          onChange({
            harness: nextHarness,
            ...(invalidated
              ? { model: undefined, modelProvider: undefined }
              : {}),
          });
        }}
      />

      <SearchableSelect
        id="automation-agent-model"
        label={t('editor.fields.model')}
        placeholder={tProjects('agents.modelPlaceholder')}
        searchPlaceholder={tProjects('agents.modelSearchPlaceholder')}
        emptyText={tProjects('agents.modelSearchEmpty')}
        options={modelOptions}
        required
        disabled={readOnly}
        value={
          displayedModel !== undefined
            ? String(offeredModels.indexOf(displayedModel))
            : null
        }
        {...(modelUnlisted
          ? { description: t('editor.agent.modelUnlisted', { model }) }
          : unpinnedDescription !== undefined
            ? { description: unpinnedDescription }
            : {})}
        onValueChange={(value) => {
          const option = offeredModels[Number(value)];
          if (option === undefined) return;
          onChange({ model: option.id, modelProvider: option.providerSlug });
        }}
      />

      <SkillsMenu
        skills={capabilities.data?.skills ?? []}
        connectors={capabilities.data?.connectors ?? []}
        tools={toolOptions}
        value={binding}
        disabled={readOnly}
        onChange={(next) =>
          onChange({
            skills: emptyToUndef(next.skills),
            connectors: emptyToUndef(next.connectors),
            tools: emptyToUndef(next.tools),
          })
        }
        label={t('editor.agent.equipmentLabel')}
        description={tProjects('agents.equipmentHint')}
      />

      <AgentSecretsField
        organizationId={organizationId}
        secrets={orgSecrets ?? []}
        selected={readStringArray(node, 'secrets')}
        onChange={(names) => onChange({ secrets: emptyToUndef(names) })}
        disabled={readOnly}
      />
    </Stack>
  );
}
