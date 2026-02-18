import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { CustomAgentActiveToggle } from '@/app/features/custom-agents/components/custom-agent-active-toggle';
import { useUpdateCustomAgentMetadata } from '@/app/features/custom-agents/hooks/mutations';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId/')({
  head: () => ({
    meta: seo('agentSettings'),
  }),
  component: GeneralTab,
});

const NO_TEAM_VALUE = '__none__';

interface GeneralFormData {
  name: string;
  displayName: string;
  description: string;
}

interface CombinedSaveData extends GeneralFormData {
  teamId?: string;
  sharedWithTeamIds: string[];
}

function GeneralTab() {
  const { agentId } = Route.useParams();
  const { t } = useT('settings');
  const { agent, isReadOnly } = useCustomAgentVersion();
  const updateMetadata = useUpdateCustomAgentMetadata();
  const { teams } = useTeamFilter();

  const form = useForm<GeneralFormData>({
    values: agent
      ? {
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description ?? '',
        }
      : undefined,
  });

  const formValues = form.watch();

  const [teamId, setTeamId] = useState<string | undefined>(undefined);
  const [sharedWithTeamIds, setSharedWithTeamIds] = useState<string[]>([]);
  const [accessInitialized, setAccessInitialized] = useState(false);

  useEffect(() => {
    if (agent && !accessInitialized) {
      setTeamId(agent.teamId || undefined);
      setSharedWithTeamIds(agent.sharedWithTeamIds ?? []);
      setAccessInitialized(true);
    }
  }, [agent, accessInitialized]);

  const combinedData = useMemo<CombinedSaveData | undefined>(
    () => (agent ? { ...formValues, teamId, sharedWithTeamIds } : undefined),
    [agent, formValues, teamId, sharedWithTeamIds],
  );

  const handleSave = useCallback(
    async (data: CombinedSaveData) => {
      await updateMetadata.mutateAsync({
        customAgentId: toId<'customAgents'>(agentId),
        name: data.name,
        displayName: data.displayName,
        description: data.description || undefined,
        teamId: data.teamId ?? '',
        sharedWithTeamIds: data.sharedWithTeamIds,
      });
    },
    [agentId, updateMetadata],
  );

  const { status } = useAutoSave({
    data: combinedData,
    onSave: handleSave,
    enabled: !!agent && accessInitialized && !isReadOnly,
  });

  const teamOptions = useMemo(() => {
    const items = [
      { value: NO_TEAM_VALUE, label: t('customAgents.form.teamNone') },
    ];
    if (teams) {
      for (const team of teams) {
        items.push({ value: team.id, label: team.name });
      }
    }
    return items;
  }, [teams, t]);

  const shareableTeams = useMemo(() => {
    if (!teams || !teamId) return [];
    return teams.filter((team) => team.id !== teamId);
  }, [teams, teamId]);

  const handleTeamChange = (val: string) => {
    const resolved = val === NO_TEAM_VALUE ? undefined : val;
    setTeamId(resolved);
    if (!resolved) setSharedWithTeamIds([]);
  };

  const handleToggleSharedTeam = (id: string) => {
    setSharedWithTeamIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return [...set];
    });
  };

  return (
    <NarrowContainer className="py-4">
      <Stack gap={6}>
        <StickySectionHeader
          title={t('customAgents.form.sectionGeneral')}
          description={t('customAgents.form.sectionGeneralDescription')}
          action={<AutoSaveIndicator status={status} />}
        />

        {agent && (
          <CustomAgentActiveToggle
            agent={agent}
            label={t('customAgents.general.active')}
            description={t('customAgents.general.activeHelp')}
          />
        )}

        <Stack gap={3}>
          <Input
            id="name"
            label={t('customAgents.form.name')}
            placeholder={t('customAgents.form.namePlaceholder')}
            description={t('customAgents.form.nameHelp')}
            {...form.register('name', { required: true })}
            required
            disabled={isReadOnly}
            errorMessage={form.formState.errors.name?.message}
          />

          <Input
            id="displayName"
            label={t('customAgents.form.displayName')}
            placeholder={t('customAgents.form.displayNamePlaceholder')}
            {...form.register('displayName', { required: true })}
            required
            disabled={isReadOnly}
            errorMessage={form.formState.errors.displayName?.message}
          />

          <Textarea
            id="description"
            label={t('customAgents.form.description')}
            placeholder={t('customAgents.form.descriptionPlaceholder')}
            {...form.register('description')}
            rows={2}
            disabled={isReadOnly}
          />
        </Stack>
      </Stack>

      {teams && teams.length > 0 && (
        <PageSection
          title={t('customAgents.form.sectionAccess')}
          description={t('customAgents.form.sectionAccessDescription')}
          gap={6}
          className="mt-8 border-t pt-8"
        >
          <Stack gap={3}>
            <Select
              options={teamOptions}
              label={t('customAgents.form.team')}
              description={t('customAgents.form.teamHelp')}
              value={teamId || NO_TEAM_VALUE}
              onValueChange={handleTeamChange}
              disabled={isReadOnly}
            />

            {teamId && shareableTeams.length > 0 && (
              <FormSection
                label={t('customAgents.form.sharedWithTeams')}
                description={t('customAgents.form.sharedWithTeamsHelp')}
              >
                {shareableTeams.map((team) => (
                  <Checkbox
                    key={team.id}
                    label={team.name}
                    checked={sharedWithTeamIds.includes(team.id)}
                    onCheckedChange={() => handleToggleSharedTeam(team.id)}
                    disabled={isReadOnly}
                  />
                ))}
              </FormSection>
            )}
          </Stack>
        </PageSection>
      )}
    </NarrowContainer>
  );
}
