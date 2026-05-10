import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useCallback, useMemo, useState, useEffect } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import {
  useUpdateAgentBindings,
  useUpdateAgentSharing,
  useTranslateAgentFields,
} from '@/app/features/agents/hooks/mutations';
import { useAgentBinding } from '@/app/features/agents/hooks/queries';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';
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
  const { data: organization } = useOrganization(organizationId);
  const updateBindings = useUpdateAgentBindings();
  const updateSharing = useUpdateAgentSharing();
  const translateMutation = useTranslateAgentFields();

  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);
  const [editingLocale, setEditingLocale] = useState(defaultLocale);

  const legacyDisplayName = config.displayName ?? '';
  const legacyDescription = config.description ?? '';

  // Read from i18n for the active tab; fall back to the legacy top-level
  // fields only when editing the default-locale tab on a pre-i18n agent.
  const displayNameValue =
    config.i18n?.[editingLocale]?.displayName ??
    (editingLocale === defaultLocale ? legacyDisplayName : '');
  const descriptionValue =
    config.i18n?.[editingLocale]?.description ??
    (editingLocale === defaultLocale ? legacyDescription : '');

  const hasTranslation = useCallback(
    (locale: string): boolean => {
      const entry = config.i18n?.[locale];
      if (entry?.displayName || entry?.description) return true;
      // Legacy fallback — a pre-i18n agent should show the default-locale tab
      // as translated if the top-level field has content.
      if (
        locale === defaultLocale &&
        (legacyDisplayName || legacyDescription)
      ) {
        return true;
      }
      return false;
    },
    [config.i18n, defaultLocale, legacyDisplayName, legacyDescription],
  );

  const writeFields = useCallback(
    (patch: { displayName?: string; description?: string }) => {
      const existingI18n = config.i18n ?? {};
      const existingOverrides = existingI18n[editingLocale] ?? {};
      const next = { ...existingOverrides };
      if ('displayName' in patch) {
        const v = patch.displayName?.trim();
        next.displayName = v ? patch.displayName : undefined;
      }
      if ('description' in patch) {
        const v = patch.description?.trim();
        next.description = v ? patch.description : undefined;
      }
      // Server-side `normalizeAgentConfig` enforces the legacy-retirement
      // invariant (I-1) at the write boundary, so the UI just writes the
      // edit into i18n[editingLocale] and the server strips top-level
      // translatables when i18n[defaultLocale] carries content.
      updateConfig({
        i18n: {
          ...existingI18n,
          [editingLocale]: next,
        },
      });
    },
    [config.i18n, editingLocale, updateConfig],
  );

  const sourceDisplayName =
    config.i18n?.[defaultLocale]?.displayName ?? legacyDisplayName;
  const sourceDescription =
    config.i18n?.[defaultLocale]?.description ?? legacyDescription;
  const hasSource = !!sourceDisplayName || !!sourceDescription;

  const handleAutoTranslate = useCallback(async () => {
    if (editingLocale === defaultLocale || !hasSource) return;
    const target = editingLocale;
    const fields: Record<string, string> = {};
    if (sourceDisplayName) fields.displayName = sourceDisplayName;
    if (sourceDescription) fields.description = sourceDescription;
    try {
      const result = await translateMutation.mutateAsync({
        fields,
        targetLocale: target,
      });
      if (result.error) {
        toast({
          title: t('agents.conversationStarters.translateError'),
          variant: 'destructive',
        });
        return;
      }
      if (editingLocale !== target) return;
      const existingI18n = config.i18n ?? {};
      const existingOverrides = existingI18n[target] ?? {};
      const next = { ...existingOverrides };
      const td = result.translated.displayName;
      const tdesc = result.translated.description;
      if (typeof td === 'string') next.displayName = td;
      if (typeof tdesc === 'string') next.description = tdesc;
      updateConfig({
        i18n: {
          ...existingI18n,
          [target]: next,
        },
      });
    } catch (error) {
      console.error('[auto-translate]', error);
      toast({
        title: t('agents.conversationStarters.translateError'),
        variant: 'destructive',
      });
    }
  }, [
    editingLocale,
    defaultLocale,
    hasSource,
    sourceDisplayName,
    sourceDescription,
    translateMutation,
    config.i18n,
    updateConfig,
    t,
  ]);

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

  const owningTeamId = binding?.teamId ?? null;

  // Teams available for sharing (exclude the owning team)
  const shareableTeams = useMemo(() => {
    if (!teams || !owningTeamId) return [];
    return teams.filter((team) => team.id !== owningTeamId);
  }, [teams, owningTeamId]);

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

  const handleSharingChange = useCallback(
    (teamIds: string[]) => {
      updateSharing
        .mutateAsync({
          organizationId,
          agentSlug,
          teamIds,
        })
        .then(() => {
          toast({
            title: t('agents.form.sharingUpdateSuccess'),
            variant: 'success',
          });
        })
        .catch(() => {
          toast({
            title: t('agents.form.sharingUpdateFailed'),
            variant: 'destructive',
          });
        });
    },
    [updateSharing, organizationId, agentSlug, t],
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
        <LocaleTabs
          defaultLocale={defaultLocale}
          editingLocale={editingLocale}
          onEditingLocaleChange={setEditingLocale}
          hasTranslation={hasTranslation}
          onAutoTranslate={hasSource ? handleAutoTranslate : undefined}
          isTranslating={translateMutation.isPending}
        />
        <Input
          id="displayName"
          label={t('agents.form.displayName')}
          placeholder={t('agents.form.displayNamePlaceholder')}
          value={displayNameValue}
          onChange={(e) => writeFields({ displayName: e.target.value })}
          required
        />
        <Textarea
          id="description"
          label={t('agents.form.description')}
          placeholder={t('agents.form.descriptionPlaceholder')}
          value={descriptionValue}
          onChange={(e) => writeFields({ description: e.target.value })}
          rows={2}
        />
      </FormSection>

      <PageSection
        title={t('agents.form.sectionAccess')}
        description={t('agents.form.sectionAccessDescription')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        {teams && teams.length > 0 ? (
          <>
            <FormSection>
              <Select
                options={teamOptions}
                label={t('agents.form.team')}
                description={t('agents.form.teamHelp')}
                value={binding?.teamId ?? NO_TEAM_VALUE}
                onValueChange={handleTeamChange}
              />
            </FormSection>

            {owningTeamId && shareableTeams.length > 0 && (
              <FormSection>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    {t('agents.form.sharedWithTeams')}
                  </label>
                  <p className="text-muted-foreground text-sm">
                    {t('agents.form.sharedWithTeamsHelp')}
                  </p>
                  <TeamMultiSelect
                    teams={shareableTeams}
                    selectedTeamIds={binding?.sharedWithTeamIds ?? []}
                    onSelectionChange={handleSharingChange}
                    orgWideLabel={t('agents.form.noSharedTeams')}
                  />
                </div>
              </FormSection>
            )}
          </>
        ) : (
          <FormSection>
            <p className="text-muted-foreground text-sm">
              {t('agents.form.noTeamsHint')}{' '}
              <Link
                to="/dashboard/$id/settings/teams"
                params={{ id: organizationId }}
                className="text-primary hover:underline"
              >
                {t('agents.form.noTeamsCreateLink')}
              </Link>
            </p>
          </FormSection>
        )}
      </PageSection>

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
