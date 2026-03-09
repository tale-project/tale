import { createFileRoute } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { ContentArea } from '@/app/components/layout/content-area';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { AutoSaveIndicator } from '@/app/features/custom-agents/components/auto-save-indicator';
import { CustomAgentActiveToggle } from '@/app/features/custom-agents/components/custom-agent-active-toggle';
import {
  useUpdateCustomAgentMetadata,
  useUpdateCustomAgentVisibility,
} from '@/app/features/custom-agents/hooks/mutations';
import { useAutoSave } from '@/app/features/custom-agents/hooks/use-auto-save';
import { useCustomAgentVersion } from '@/app/features/custom-agents/hooks/use-custom-agent-version-context';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
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
  const { mutate: updateVisibility, isPending: isUpdatingVisibility } =
    useUpdateCustomAgentVisibility();
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
      });
    },
    [agentId, updateMetadata],
  );

  const { status, save } = useAutoSave({
    data: combinedData,
    onSave: handleSave,
    enabled: !!agent && accessInitialized && !isReadOnly,
    mode: 'manual',
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

  const handleVisibilityChange = useCallback(
    (checked: boolean) => {
      updateVisibility(
        {
          customAgentId: toId<'customAgents'>(agentId),
          visibleInChat: checked,
        },
        {
          onSuccess: () => {
            toast({
              title: t('customAgents.general.visibilityUpdated'),
              variant: 'success',
            });
          },
          onError: () => {
            toast({
              title: t('customAgents.general.visibilityUpdateFailed'),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [agentId, updateVisibility, t],
  );

  const nameField = form.register('name', { required: true });
  const displayNameField = form.register('displayName', { required: true });
  const descriptionField = form.register('description');

  const handleTeamChange = (val: string) => {
    const resolved = val === NO_TEAM_VALUE ? undefined : val;
    setTeamId(resolved);
    const newShared = resolved ? sharedWithTeamIds : [];
    if (!resolved) setSharedWithTeamIds(newShared);
    void save({
      ...form.getValues(),
      teamId: resolved,
      sharedWithTeamIds: newShared,
    });
  };

  const handleToggleSharedTeam = (id: string) => {
    const newShared = sharedWithTeamIds.includes(id)
      ? sharedWithTeamIds.filter((sid) => sid !== id)
      : [...sharedWithTeamIds, id];
    setSharedWithTeamIds(newShared);
    void save({
      ...form.getValues(),
      teamId,
      sharedWithTeamIds: newShared,
    });
  };

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('customAgents.form.sectionGeneral')}
        description={t('customAgents.form.sectionGeneralDescription')}
        action={<AutoSaveIndicator status={status} />}
      />

      {agent && (
        <FormSection>
          <CustomAgentActiveToggle
            agent={agent}
            label={t('customAgents.general.active')}
            description={t('customAgents.general.activeHelp')}
          />
          <Switch
            checked={agent.visibleInChat !== false}
            onCheckedChange={handleVisibilityChange}
            disabled={isReadOnly || isUpdatingVisibility}
            label={t('customAgents.general.visibleInChat')}
            description={t('customAgents.general.visibleInChatHelp')}
          />
        </FormSection>
      )}

      <FormSection>
        <Input
          id="name"
          label={t('customAgents.form.name')}
          placeholder={t('customAgents.form.namePlaceholder')}
          description={t('customAgents.form.nameHelp')}
          {...nameField}
          onBlur={(e) => {
            void nameField.onBlur(e);
            void save();
          }}
          required
          disabled={isReadOnly}
          errorMessage={form.formState.errors.name?.message}
        />

        <Input
          id="displayName"
          label={t('customAgents.form.displayName')}
          placeholder={t('customAgents.form.displayNamePlaceholder')}
          {...displayNameField}
          onBlur={(e) => {
            void displayNameField.onBlur(e);
            void save();
          }}
          required
          disabled={isReadOnly}
          errorMessage={form.formState.errors.displayName?.message}
        />

        <Textarea
          id="description"
          label={t('customAgents.form.description')}
          placeholder={t('customAgents.form.descriptionPlaceholder')}
          {...descriptionField}
          onBlur={(e) => {
            void descriptionField.onBlur(e);
            void save();
          }}
          rows={2}
          disabled={isReadOnly}
        />
      </FormSection>

      {teams && teams.length > 0 && (
        <PageSection
          title={t('customAgents.form.sectionAccess')}
          description={t('customAgents.form.sectionAccessDescription')}
          gap={6}
          className="mt-8 border-t pt-8"
        >
          <FormSection>
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
          </FormSection>
        </PageSection>
      )}
    </ContentArea>
  );
}
