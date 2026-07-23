'use client';

/**
 * User preferences — the two personalization features, each as one section
 * that owns both its switch and its fields.
 *
 * The switch lives in the section header and the fields live in the section
 * body: turning a feature on reveals what it needs right there, so a user
 * never flips a toggle and then has to find a second place to fill it in.
 * Turning it off leaves the fields visible but inert, so the stored value
 * stays readable instead of vanishing.
 *
 * Reading replies aloud is NOT here. It is a property of the message being
 * sent, so it lives in the composer's mode menu; duplicating it as a stored
 * preference would give the same behaviour two sources of truth.
 */

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useState, type ReactNode } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useChatMemories } from '@/app/features/chat/data/chat-backend';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useSetCustomInstructionsEnabled,
  useSetMemoriesEnabled,
  useUpsertMyPreferences,
} from '../hooks/mutations';

/** Backend cap, mirrored so the counter and the field agree with the writer. */
const CUSTOM_INSTRUCTIONS_MAX_CHARS = 4000;

/**
 * A feature is on when the user said so, and follows the org's default when
 * they have not. Both states are shown, so "on" and "on because your org says
 * so" never look the same.
 */
interface FeatureGate {
  readonly orgDefaultOn: boolean;
  readonly followingDefault: boolean;
  readonly effective: boolean;
}

function resolveGate(
  userChoice: boolean | undefined,
  orgDefaultOn: boolean,
): FeatureGate {
  const followingDefault = userChoice === undefined;
  return {
    orgDefaultOn,
    followingDefault,
    effective: followingDefault ? orgDefaultOn : userChoice,
  };
}

function policyEnabled(config: unknown): boolean {
  return isRecord(config) && config.enabled === true;
}

export function PreferencesSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('personalization');

  const { data: prefs, isLoading: prefsLoading } = useConvexQuery(
    api.user_preferences.queries.getMyPreferences,
    { organizationId },
  );
  const { data: instructionsPolicy } = useGovernancePolicy(
    organizationId,
    'custom_instructions',
  );
  const { data: memoriesPolicy } = useGovernancePolicy(
    organizationId,
    'user_memories',
  );

  const instructionsGate = resolveGate(
    prefs?.customInstructionsEnabled,
    policyEnabled(instructionsPolicy?.config),
  );
  const memoriesGate = resolveGate(
    prefs?.memoriesEnabled,
    policyEnabled(memoriesPolicy?.config),
  );

  return (
    <Skeletonize loading={prefsLoading} label={t('page.title')}>
      <SettingsPage>
        <CustomInstructionsSection
          organizationId={organizationId}
          gate={instructionsGate}
          savedInstructions={prefs?.customInstructions ?? ''}
        />
        <MemoriesSection organizationId={organizationId} gate={memoriesGate} />
      </SettingsPage>
    </Skeletonize>
  );
}

/** The hint under a switch explaining which way the org default points. */
function useGateHint(gate: FeatureGate, base: string): ReactNode {
  const { t } = useT('personalization');
  const state = gate.orgDefaultOn
    ? t('page.enable.orgStateOn')
    : t('page.enable.orgStateOff');
  const hint = gate.followingDefault
    ? t('page.enable.followingOrgDefault', { state })
    : t('page.enable.overridingOrgDefault', { state });
  return (
    <>
      {base} <span className="text-muted-foreground">{hint}</span>
    </>
  );
}

function CustomInstructionsSection({
  organizationId,
  gate,
  savedInstructions,
}: {
  organizationId: string;
  gate: FeatureGate;
  savedInstructions: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled, isPending: togglePending } =
    useSetCustomInstructionsEnabled();
  const { mutateAsync: upsert, isPending: savePending } =
    useUpsertMyPreferences();

  const [draft, setDraft] = useState<string>();
  const value = draft ?? savedInstructions;
  const tooLong = value.length > CUSTOM_INSTRUCTIONS_MAX_CHARS;
  const dirty = draft !== undefined && draft !== savedInstructions;

  const description = useGateHint(
    gate,
    t('page.customInstructionsToggle.description'),
  );

  return (
    <SettingsSection
      title={t('page.customInstructions.title')}
      description={description}
      action={
        <Switch
          label={t('page.customInstructionsToggle.label')}
          hideLabelOnMobile
          checked={gate.effective}
          disabled={togglePending}
          onCheckedChange={async (next) => {
            try {
              await setEnabled({ organizationId, enabled: next });
              toast({ title: t('toasts.preferencesUpdated') });
            } catch {
              toast({
                title: t('errors.saveFailed'),
                variant: 'destructive',
              });
            }
          }}
        />
      }
    >
      <Stack gap={2}>
        <Textarea
          aria-label={t('page.customInstructions.title')}
          placeholder={t('page.customInstructions.placeholder')}
          rows={5}
          value={value}
          disabled={!gate.effective || savePending}
          errorMessage={
            tooLong
              ? t('errors.tooLong', {
                  max: CUSTOM_INSTRUCTIONS_MAX_CHARS,
                })
              : undefined
          }
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <Text variant="muted" className="text-xs">
            {t('page.customInstructions.counter', { count: value.length })}
          </Text>
          <Button
            variant="primary"
            size="sm"
            disabled={!gate.effective || !dirty || tooLong || savePending}
            onClick={async () => {
              try {
                await upsert({ organizationId, customInstructions: value });
                setDraft(undefined);
                toast({ title: t('toasts.saved') });
              } catch {
                toast({
                  title: t('errors.saveFailed'),
                  variant: 'destructive',
                });
              }
            }}
          >
            {t('card.save')}
          </Button>
        </div>
      </Stack>
    </SettingsSection>
  );
}

function MemoriesSection({
  organizationId,
  gate,
}: {
  organizationId: string;
  gate: FeatureGate;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled, isPending } = useSetMemoriesEnabled();
  const memories = useChatMemories(organizationId);

  const description = useGateHint(gate, t('page.memoriesToggle.description'));

  return (
    <SettingsSection
      className="border-border border-t pt-8"
      title={t('page.memories.title')}
      description={description}
      action={
        <Switch
          label={t('page.memoriesToggle.label')}
          hideLabelOnMobile
          checked={gate.effective}
          disabled={isPending}
          onCheckedChange={async (next) => {
            try {
              await setEnabled({ organizationId, enabled: next });
              toast({ title: t('toasts.preferencesUpdated') });
            } catch {
              toast({
                title: t('errors.saveFailed'),
                variant: 'destructive',
              });
            }
          }}
        />
      }
    >
      <Stack gap={6}>
        <MemoryList
          title={t('page.pending.title')}
          empty={t('page.pending.empty')}
          entries={
            memories.status === 'ready' ? memories.data.pending : undefined
          }
        />
        <MemoryList
          title={t('page.memories.title')}
          empty={t('page.memories.empty')}
          entries={
            memories.status === 'ready' ? memories.data.approved : undefined
          }
        />
      </Stack>
    </SettingsSection>
  );
}

/**
 * One memory list. `entries` is `undefined` while the memories backend has
 * not answered — the list says nothing has loaded rather than claiming the
 * user has no memories. The lists are read-only until the memory mutations
 * exist behind the same seam that feeds them; a review control that silently
 * did nothing would be worse than none.
 */
function MemoryList({
  title,
  empty,
  entries,
}: {
  title: string;
  empty: string;
  entries?: readonly { id: string; content: string }[];
}) {
  const { t: tChat } = useT('chat');

  return (
    <Stack gap={2}>
      <Text variant="muted" className="text-xs font-medium uppercase">
        {title}
      </Text>
      {entries === undefined ? (
        <Text variant="muted" className="text-sm">
          {tChat('backendUnavailable.title')}
        </Text>
      ) : entries.length === 0 ? (
        <Text variant="muted" className="text-sm">
          {empty}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2">
              <Text className="flex-1">{entry.content}</Text>
            </li>
          ))}
        </ul>
      )}
    </Stack>
  );
}
