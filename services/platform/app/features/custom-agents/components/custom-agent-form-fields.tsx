'use client';

import { useMemo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Stack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { ToolSelector } from './tool-selector';
import type { CreateCustomAgent } from '@/lib/shared/schemas/custom_agents';

type FormData = Omit<CreateCustomAgent, 'organizationId'>;

interface CustomAgentFormFieldsProps {
  form: UseFormReturn<FormData>;
}

const MODEL_PRESET_OPTIONS = [
  { value: 'fast', label: 'Fast' },
  { value: 'standard', label: 'Standard' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'vision', label: 'Vision' },
];

export function CustomAgentFormFields({ form }: CustomAgentFormFieldsProps) {
  const { t } = useT('settings');
  const { register, formState, watch, setValue } = form;
  const includeKnowledge = watch('includeKnowledge');
  const toolNames = watch('toolNames');
  const teamId = watch('teamId');
  const sharedWithTeamIds = watch('sharedWithTeamIds') ?? [];
  const { teams } = useTeamFilter();

  const modelOptions = MODEL_PRESET_OPTIONS.map((opt) => ({
    ...opt,
    label: t(`customAgents.form.modelPresets.${opt.value}`),
  }));

  const teamOptions = useMemo(() => {
    const items = [
      { value: '', label: t('customAgents.form.teamNone') },
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

  const handleToggleSharedTeam = (id: string) => {
    const current = new Set(sharedWithTeamIds);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    setValue('sharedWithTeamIds', [...current]);
  };

  return (
    <Stack gap={4}>
      <fieldset>
        <Stack gap={3}>
          <Input
            id="name"
            label={t('customAgents.form.name')}
            placeholder={t('customAgents.form.namePlaceholder')}
            {...register('name')}
            required
            errorMessage={formState.errors.name?.message}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            {t('customAgents.form.nameHelp')}
          </p>

          <Input
            id="displayName"
            label={t('customAgents.form.displayName')}
            placeholder={t('customAgents.form.displayNamePlaceholder')}
            {...register('displayName')}
            required
            errorMessage={formState.errors.displayName?.message}
          />

          <Textarea
            id="description"
            label={t('customAgents.form.description')}
            placeholder={t('customAgents.form.descriptionPlaceholder')}
            {...register('description')}
            rows={2}
          />
        </Stack>
      </fieldset>

      <fieldset>
        <Stack gap={3}>
          <Textarea
            id="systemInstructions"
            label={t('customAgents.form.systemInstructions')}
            placeholder={t('customAgents.form.systemInstructionsPlaceholder')}
            {...register('systemInstructions')}
            required
            rows={8}
            className="font-mono text-sm"
            errorMessage={formState.errors.systemInstructions?.message}
          />
        </Stack>
      </fieldset>

      <fieldset>
        <Stack gap={3}>
          <Select
            options={modelOptions}
            label={t('customAgents.form.modelPreset')}
            value={watch('modelPreset')}
            onValueChange={(val) => setValue('modelPreset', val as FormData['modelPreset'])}
            required
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              id="temperature"
              label={t('customAgents.form.temperature')}
              type="number"
              step={0.1}
              min={0}
              max={2}
              {...register('temperature', { valueAsNumber: true })}
            />
            <Input
              id="maxTokens"
              label={t('customAgents.form.maxTokens')}
              type="number"
              min={1}
              max={128000}
              {...register('maxTokens', { valueAsNumber: true })}
            />
            <Input
              id="maxSteps"
              label={t('customAgents.form.maxSteps')}
              type="number"
              min={1}
              max={100}
              {...register('maxSteps', { valueAsNumber: true })}
            />
          </div>
        </Stack>
      </fieldset>

      <ToolSelector
        value={toolNames ?? []}
        onChange={(tools) => setValue('toolNames', tools)}
      />

      <fieldset>
        <Stack gap={3}>
          <Switch
            label={t('customAgents.form.includeKnowledge')}
            checked={includeKnowledge}
            onCheckedChange={(checked) => setValue('includeKnowledge', checked === true)}
          />
          {includeKnowledge && (
            <Input
              id="knowledgeTopK"
              label={t('customAgents.form.knowledgeTopK')}
              type="number"
              min={1}
              max={50}
              {...register('knowledgeTopK', { valueAsNumber: true })}
            />
          )}
        </Stack>
      </fieldset>

      {teams && teams.length > 0 && (
        <fieldset>
          <Stack gap={3}>
            <Select
              options={teamOptions}
              label={t('customAgents.form.team')}
              value={teamId ?? ''}
              onValueChange={(val) => {
                setValue('teamId', val || undefined);
                if (!val) setValue('sharedWithTeamIds', undefined);
              }}
            />
            <p className="text-xs text-muted-foreground -mt-2">
              {t('customAgents.form.teamHelp')}
            </p>

            {teamId && shareableTeams.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">
                  {t('customAgents.form.sharedWithTeams')}
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  {t('customAgents.form.sharedWithTeamsHelp')}
                </p>
                <div className="space-y-2">
                  {shareableTeams.map((team) => (
                    <Checkbox
                      key={team.id}
                      label={team.name}
                      checked={sharedWithTeamIds.includes(team.id)}
                      onCheckedChange={() => handleToggleSharedTeam(team.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </Stack>
        </fieldset>
      )}
    </Stack>
  );
}
