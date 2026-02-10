import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useUpdateCustomAgentMetadata } from '@/app/features/custom-agents/hooks/use-custom-agent-mutations';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { toId } from '@/lib/utils/type-guards';

export const Route = createFileRoute('/dashboard/$id/custom-agents/$agentId/')({
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
      await updateMetadata({
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
        <div className="bg-background sticky top-[49px] z-40 -mx-4 flex items-center justify-between px-4 md:top-[97px]">
          <Stack gap={1}>
            <h2 className="text-foreground text-base font-semibold">
              {t('customAgents.form.sectionGeneral')}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t('customAgents.form.sectionGeneralDescription')}
            </p>
          </Stack>
          <AutoSaveIndicator status={status} />
        </div>

        <Stack gap={3}>
          <Input
            id="name"
            label={t('customAgents.form.name')}
            placeholder={t('customAgents.form.namePlaceholder')}
            {...form.register('name', { required: true })}
            required
            disabled={isReadOnly}
            errorMessage={form.formState.errors.name?.message}
          />
          <p className="text-muted-foreground -mt-2 text-xs">
            {t('customAgents.form.nameHelp')}
          </p>

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
        <Stack gap={6} className="mt-8 border-t pt-8">
          <Stack gap={1}>
            <h2 className="text-foreground text-base font-semibold">
              {t('customAgents.form.sectionAccess')}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t('customAgents.form.sectionAccessDescription')}
            </p>
          </Stack>

          <Stack gap={3}>
            <Select
              options={teamOptions}
              label={t('customAgents.form.team')}
              value={teamId || NO_TEAM_VALUE}
              onValueChange={handleTeamChange}
              disabled={isReadOnly}
            />
            <p className="text-muted-foreground -mt-2 text-xs">
              {t('customAgents.form.teamHelp')}
            </p>

            {teamId && shareableTeams.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  {t('customAgents.form.sharedWithTeams')}
                </p>
                <p className="text-muted-foreground mb-2 text-xs">
                  {t('customAgents.form.sharedWithTeamsHelp')}
                </p>
                <div className="space-y-2">
                  {shareableTeams.map((team) => (
                    <Checkbox
                      key={team.id}
                      label={team.name}
                      checked={sharedWithTeamIds.includes(team.id)}
                      onCheckedChange={() => handleToggleSharedTeam(team.id)}
                      disabled={isReadOnly}
                    />
                  ))}
                </div>
              </div>
            )}
          </Stack>
        </Stack>
      )}
    </NarrowContainer>
  );
}
