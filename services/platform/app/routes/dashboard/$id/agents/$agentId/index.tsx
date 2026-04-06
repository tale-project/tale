import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState, useEffect } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { useUpdateAgentBindings } from '@/app/features/agents/hooks/mutations';
import { useAgentBinding } from '@/app/features/agents/hooks/queries';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/')({
  head: () => ({
    meta: seo('agentSettings'),
  }),
  component: GeneralTab,
});

const NO_TEAM_VALUE = '__none__';
const DEFAULT_TIMEOUT_MINUTES = 7;

function GeneralTab() {
  const { t } = useT('settings');
  const { id: organizationId, agentId: agentSlug } = Route.useParams();
  const { config, updateConfig } = useAgentConfig();
  const { teams } = useTeamFilter();
  const { data: binding } = useAgentBinding(organizationId, agentSlug);
  const updateBindings = useUpdateAgentBindings();

  const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
  const [timeoutInitialized, setTimeoutInitialized] = useState(false);

  useEffect(() => {
    if (!timeoutInitialized) {
      setTimeoutMinutes(
        config.timeoutMs
          ? Math.round(config.timeoutMs / 60_000)
          : DEFAULT_TIMEOUT_MINUTES,
      );
      setTimeoutInitialized(true);
    }
  }, [config.timeoutMs, timeoutInitialized]);

  const teamOptions = useMemo(() => {
    const items = [{ value: NO_TEAM_VALUE, label: t('agents.form.teamNone') }];
    if (teams) {
      for (const team of teams) {
        items.push({ value: team.id, label: team.name });
      }
    }
    return items;
  }, [teams, t]);

  const handleTeamChange = useCallback(
    (value: string) => {
      updateBindings
        .mutateAsync({
          organizationId,
          agentSlug,
          teamId: value === NO_TEAM_VALUE ? '' : value,
        })
        .then(() => {
          toast({
            title: t('agents.form.teamUpdateSuccess'),
            variant: 'success',
          });
        })
        .catch(() => {
          toast({
            title: t('agents.form.teamUpdateFailed'),
            variant: 'destructive',
          });
        });
    },
    [updateBindings, organizationId, agentSlug, t],
  );

  const handleVisibilityChange = useCallback(
    (checked: boolean) => {
      updateConfig({ visibleInChat: checked });
    },
    [updateConfig],
  );

  const handleTimeoutBlur = useCallback(() => {
    const clamped = Math.max(1, Math.min(25, timeoutMinutes));
    setTimeoutMinutes(clamped);
    updateConfig({ timeoutMs: clamped * 60_000 });
  }, [timeoutMinutes, updateConfig]);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.form.sectionGeneral')}
        description={t('agents.form.sectionGeneralDescription')}
      />

      <FormSection>
        <Switch
          checked={config.visibleInChat === true}
          onCheckedChange={handleVisibilityChange}
          label={t('agents.general.visibleInChat')}
          description={t('agents.general.visibleInChatHelp')}
        />
      </FormSection>

      <FormSection>
        <Input
          id="displayName"
          label={t('agents.form.displayName')}
          placeholder={t('agents.form.displayNamePlaceholder')}
          value={config.displayName}
          onChange={(e) => updateConfig({ displayName: e.target.value })}
          required
        />

        <Textarea
          id="description"
          label={t('agents.form.description')}
          placeholder={t('agents.form.descriptionPlaceholder')}
          value={config.description ?? ''}
          onChange={(e) =>
            updateConfig({ description: e.target.value || undefined })
          }
          rows={2}
        />
      </FormSection>

      {teams && teams.length > 0 && (
        <PageSection
          title={t('agents.form.sectionAccess')}
          description={t('agents.form.sectionAccessDescription')}
          gap={6}
          className="mt-8 border-t pt-8"
        >
          <FormSection>
            <Select
              options={teamOptions}
              label={t('agents.form.team')}
              description={t('agents.form.teamHelp')}
              value={binding?.teamId ?? NO_TEAM_VALUE}
              onValueChange={handleTeamChange}
            />
          </FormSection>
        </PageSection>
      )}

      <PageSection
        title={t('agents.general.sectionAdvanced')}
        description={t('agents.general.sectionAdvancedDescription')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        <FormSection>
          <Input
            id="timeoutMinutes"
            type="number"
            label={t('agents.general.timeoutMinutes')}
            description={t('agents.general.timeoutMinutesHelp')}
            value={timeoutMinutes}
            onChange={(e) =>
              setTimeoutMinutes(
                Number(e.target.value) || DEFAULT_TIMEOUT_MINUTES,
              )
            }
            onBlur={handleTimeoutBlur}
            min={1}
            max={25}
            step={1}
          />
        </FormSection>
      </PageSection>
    </ContentArea>
  );
}
