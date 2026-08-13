'use client';

/**
 * The agent node's equipment, edited on the canvas with the SAME friendly
 * pickers the create wizard uses — a harness Select, the skills/connectors/
 * tools menu, and the secrets manager — instead of the raw JSON boxes the
 * generic node inspector falls back to. The node stores skills/connectors/
 * tools/secrets as flat string arrays; this component reads them into the
 * pickers and patches each field back on change (empty → removed, so the
 * document stays clean).
 */

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import {
  SkillsMenu,
  type SkillOption,
  type SkillsSelection,
} from '@/app/components/skills/skills-menu';
import { Select } from '@/app/components/ui/forms/select';
import { AgentSecretsField } from '@/app/features/projects/components/agent-secrets-field';
import {
  useAgentSecrets,
  useProjectHarnesses,
} from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { AGENT_TOOL_CATALOG } from '@/convex/sandbox/tool_names';
import type { NodeDef } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { useAutomationCapabilities } from '../hooks/queries';

/** Sentinel for the harness Select's "default" choice — Radix Select items
 * cannot carry an empty-string value, so an unset harness maps to this. */
const HARNESS_DEFAULT = '__default__';

/** The node fields this component owns — the inspector must NOT also render
 * them through its generic field loop. */
export const AGENT_EQUIPMENT_FIELDS: readonly string[] = [
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
  projectId?: Id<'projects'>;
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

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text as="span" variant="caption" className="font-medium">
          {t('editor.fields.harness')}
        </Text>
        <Select
          placeholder={t('editor.agent.harnessDefault')}
          options={harnessOptions}
          value={harness === '' ? HARNESS_DEFAULT : harness}
          disabled={readOnly}
          onValueChange={(value) => {
            // Radix fires a spurious '' on unmount — never act on it.
            if (value === '') return;
            onChange({
              harness: value === HARNESS_DEFAULT ? undefined : value,
            });
          }}
        />
      </Stack>

      <Stack gap={1}>
        <Text as="span" variant="caption" className="font-medium">
          {t('editor.agent.equipmentLabel')}
        </Text>
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
        />
      </Stack>

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
