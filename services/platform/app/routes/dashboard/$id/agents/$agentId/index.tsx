import { PageSection } from '@tale/ui/page-section';
import { SectionHeader } from '@tale/ui/section-header';
import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { LocaleTabs } from '@/app/components/ui/i18n/locale-tabs';
import {
  useUpdateAgentBindings,
  useUpdateAgentSharing,
  useTranslateAgentFields,
} from '@/app/features/agents/hooks/mutations';
import { useAgentBinding } from '@/app/features/agents/hooks/queries';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import {
  nextConfigForBehavior,
  type AgentPrimaryBehavior,
} from '@/app/features/agents/utils/next-config-for-behavior';
import { TeamMultiSelect } from '@/app/features/documents/components/team-multi-select';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { listProductAgentSlugs } from '@/lib/agent-adapters/registry';
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
        organizationId,
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
    organizationId,
    config.i18n,
    updateConfig,
    t,
  ]);

  // Displayed minutes are DERIVED from `config.timeoutMs` (the source of
  // truth) so a restore / any `overrideConfig` rehydrates the input — no
  // one-shot useState mirror that latches the first value forever. While the
  // user is actively typing we hold the raw text in `timeoutDraft`; it is
  // `null` whenever the field is not being edited, so the input falls back to
  // `config`. Clearing the draft on blur re-syncs the display to `config`.
  const configTimeoutMinutes = config.timeoutMs
    ? Math.round(config.timeoutMs / 60_000)
    : DEFAULT_TIMEOUT_MINUTES;
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  const timeoutValue = timeoutDraft ?? String(configTimeoutMinutes);

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

  // Commit a clamped minutes value into `config`, but only when it actually
  // differs from what `config` already holds — so blurring a field the user
  // never edited can never re-mark the form dirty or clobber a restored value.
  const commitTimeout = useCallback(
    (minutes: number) => {
      const clamped = Math.max(1, Math.min(25, Math.round(minutes)));
      const nextMs = clamped * 60_000;
      if (nextMs !== config.timeoutMs) {
        updateConfig({ timeoutMs: nextMs });
      }
    },
    [config.timeoutMs, updateConfig],
  );

  const handleTimeoutChange = useCallback(
    (raw: string) => {
      setTimeoutDraft(raw);
      // Only push valid numeric input through to `config`; an empty/partial
      // entry stays in the draft until blur so typing isn't fought.
      if (raw !== '') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) commitTimeout(parsed);
      }
    },
    [commitTimeout],
  );

  const handleTimeoutBlur = useCallback(() => {
    // Re-sync the display to `config` once editing ends.
    if (timeoutDraft === null) return;
    const parsed = Number(timeoutDraft);
    commitTimeout(
      timeoutDraft !== '' && Number.isFinite(parsed)
        ? parsed
        : DEFAULT_TIMEOUT_MINUTES,
    );
    setTimeoutDraft(null);
  }, [timeoutDraft, commitTimeout]);

  // Agent type (primaryBehavior) — Internal (chat, runs the platform tool loop)
  // vs External agent (Claude Code / Cursor in a sandbox) vs Image generation.
  // Switching rewires which config applies, so it goes through a confirm dialog
  // and a Zod-safe field cleanup (see nextConfigForBehavior).
  const primaryBehavior: AgentPrimaryBehavior =
    config.primaryBehavior ?? 'chat';
  const isExternalAgent = primaryBehavior === 'external-agent';
  const agentKind = config.agentKind ?? 'claude-code';
  const [pendingBehavior, setPendingBehavior] =
    useState<AgentPrimaryBehavior | null>(null);

  const agentTypeOptions = useMemo(
    () => [
      {
        value: 'chat',
        label: t('agents.form.agentType.internalLabel'),
        description: t('agents.form.agentType.internalDescription'),
      },
      {
        value: 'external-agent',
        label: t('agents.form.agentType.externalLabel'),
        description: t('agents.form.agentType.externalDescription'),
      },
      {
        value: 'image-generation',
        label: t('agents.form.agentType.imageLabel'),
        description: t('agents.form.agentType.imageDescription'),
      },
    ],
    [t],
  );

  const agentKindOptions = useMemo(
    () =>
      listProductAgentSlugs().map((slug) => ({
        value: slug,
        label:
          slug === 'cursor'
            ? t('agents.form.agentKind.cursor')
            : slug === 'opencode'
              ? t('agents.form.agentKind.opencode')
              : slug === 'hermes'
                ? t('agents.form.agentKind.hermes')
                : slug === 'gemini'
                  ? t('agents.form.agentKind.gemini')
                  : slug === 'codex'
                    ? t('agents.form.agentKind.codex')
                    : slug === 'openclaw'
                      ? t('agents.form.agentKind.openclaw')
                      : t('agents.form.agentKind.claudeCode'),
      })),
    [t],
  );

  const handleTypeSelect = useCallback(
    (value: string) => {
      if (
        value !== 'chat' &&
        value !== 'external-agent' &&
        value !== 'image-generation'
      ) {
        return;
      }
      if (value === primaryBehavior) return;
      setPendingBehavior(value);
    },
    [primaryBehavior],
  );

  const confirmTypeSwitch = useCallback(() => {
    if (!pendingBehavior) return;
    // Functional form so the cleanup reads the latest config (it keeps an
    // existing agentKind when re-entering External).
    updateConfig((prev) => nextConfigForBehavior(prev, pendingBehavior));
    setPendingBehavior(null);
  }, [pendingBehavior, updateConfig]);

  const handleAgentKindChange = useCallback(
    (value: string) => {
      if (
        value !== 'claude-code' &&
        value !== 'cursor' &&
        value !== 'opencode' &&
        value !== 'hermes' &&
        value !== 'gemini' &&
        value !== 'codex' &&
        value !== 'openclaw'
      ) {
        return;
      }
      // Cursor is BYO only (its CLI can't route through the platform gateway):
      // force byo and drop any platform catalog model refs, which mean nothing
      // to a raw Cursor model passthrough.
      if (value === 'cursor') {
        updateConfig({
          agentKind: 'cursor',
          authMode: 'byo',
          supportedModels: [],
        });
        return;
      }
      // OpenCode is managed-only — clear BYO and restore managed auth when
      // switching from Cursor.
      if (value === 'opencode') {
        updateConfig({
          agentKind: 'opencode',
          authMode: 'managed',
        });
        return;
      }
      updateConfig({ agentKind: value });
    },
    [updateConfig],
  );

  // Switching INTO a type that requires ≥1 model, from a byo-external agent
  // that legally has none, would fail the save — warn up front.
  const switchLeavesNoModel =
    (pendingBehavior === 'chat' || pendingBehavior === 'image-generation') &&
    (config.supportedModels ?? []).length === 0;

  const pendingDescription = !pendingBehavior
    ? null
    : `${
        pendingBehavior === 'external-agent'
          ? t('agents.form.agentType.switchToExternalDescription')
          : pendingBehavior === 'chat'
            ? t('agents.form.agentType.switchToChatDescription')
            : t('agents.form.agentType.switchToImageDescription')
      }${switchLeavesNoModel ? ` ${t('agents.form.agentType.noModelWarning')}` : ''}`;

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader
        title={t('agents.form.sectionGeneral')}
        description={t('agents.form.sectionGeneralDescription')}
      />

      <PageSection
        title={t('agents.form.agentType.sectionTitle')}
        description={t('agents.form.agentType.sectionDescription')}
        gap={6}
      >
        <FormSection>
          <RadioGroup
            value={primaryBehavior}
            onValueChange={handleTypeSelect}
            options={agentTypeOptions}
          />
        </FormSection>
        {isExternalAgent && (
          <FormSection>
            <Select
              options={agentKindOptions}
              label={t('agents.form.agentKind.label')}
              description={t('agents.form.agentKind.description')}
              value={agentKind}
              onValueChange={handleAgentKindChange}
            />
          </FormSection>
        )}
      </PageSection>

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
      >
        <FormSection>
          <Input
            id="timeoutMinutes"
            type="number"
            label={t('agents.general.timeoutMinutes')}
            description={t('agents.general.timeoutMinutesHelp')}
            value={timeoutValue}
            onChange={(e) => handleTimeoutChange(e.target.value)}
            onBlur={handleTimeoutBlur}
            min={1}
            max={25}
            step={1}
          />
        </FormSection>
      </PageSection>

      <ConfirmDialog
        open={pendingBehavior !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBehavior(null);
        }}
        title={t('agents.form.agentType.switchTitle')}
        description={pendingDescription ?? undefined}
        confirmText={t('agents.form.agentType.switchConfirm')}
        onConfirm={confirmTypeSwitch}
      />
    </ContentArea>
  );
}
