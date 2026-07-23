'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useMemo, useState } from 'react';

import { useSkills } from '@/app/features/settings/skills/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { MAX_AGENT_SKILL_BINDINGS } from '@/lib/shared/schemas/agents';

import { useAgentTab } from '../hooks/use-agent-tab';
import { AgentTabShell } from './agent-tab-shell';
import {
  AllowlistEditor,
  allowlistModeOf,
  allowlistValueFor,
  type AllowlistMode,
  type AllowlistOption,
} from './allowlist-editor';

/**
 * The agent's skill allowlist over the org's skill library (max
 * {@link MAX_AGENT_SKILL_BINDINGS} when narrowed). Absent = every skill the
 * chatting member can see; empty = none. Slugs in the file but missing from
 * the library stay visible as "kept".
 */
export function AgentSkillsTab({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { agentQuery, agent, canEdit, save, saving } = useAgentTab(
    organizationId,
    slug,
  );
  const skillsQuery = useSkills(organizationId);

  const [mode, setMode] = useState<AllowlistMode | null>(null);
  const [selected, setSelected] = useState(new Set<string>());

  useEffect(() => {
    if (agent && mode === null) {
      setMode(allowlistModeOf(agent.skills));
      setSelected(new Set(agent.skills ?? []));
    }
  }, [agent, mode]);

  const options = useMemo<AllowlistOption[]>(() => {
    const skills = skillsQuery.data?.skills ?? [];
    const known = new Set(skills.map((skill) => skill.slug));
    const fromLibrary = skills.map((skill) => ({
      id: skill.slug,
      label: skill.slug,
      description: skill.description,
    }));
    const kept = [...selected]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: id, unknown: true }));
    return [...fromLibrary, ...kept];
  }, [skillsQuery.data, selected]);

  const overCap =
    mode === 'selected' && selected.size > MAX_AGENT_SKILL_BINDINGS;

  return (
    <AgentTabShell
      isPending={agentQuery.isPending}
      isError={agentQuery.isError}
      missing={!agentQuery.isPending && !agentQuery.isError && agent == null}
    >
      {!canEdit && <Alert description={t('agents.readOnly')} />}
      <Stack gap={3}>
        <Text as="p" variant="muted" className="text-sm">
          {t('agents.form.sectionSkillBindingsDescription')}
        </Text>
        <AllowlistEditor
          mode={mode ?? 'all'}
          onModeChange={setMode}
          options={options}
          selected={selected}
          onToggle={(id, checked) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          labelKeyPrefix="skills"
          emptyCatalogText={t('agents.allowlist.noSkillsInOrg')}
          disabled={!canEdit || skillsQuery.isPending}
          counter={t('agents.form.skillBindingsCounter', {
            count: selected.size,
            max: MAX_AGENT_SKILL_BINDINGS,
          })}
        />
        {canEdit && (
          <Row gap={2} justify="end">
            <Button
              disabled={saving || mode === null || overCap}
              onClick={() =>
                void save({
                  skills: allowlistValueFor(mode ?? 'all', [...selected]),
                })
              }
            >
              {saving ? tCommon('actions.saving') : tCommon('actions.save')}
            </Button>
          </Row>
        )}
      </Stack>
    </AgentTabShell>
  );
}
