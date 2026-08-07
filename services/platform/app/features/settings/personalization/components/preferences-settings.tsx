'use client';

/**
 * User preferences — the two personalization features, each as one section
 * that owns both its switch and its fields.
 *
 * The switch lives in the section header (unlabelled — the section title
 * names the feature; the switch carries an aria-label) and the fields live in
 * the section body. Turning a feature off HIDES that section's body — a
 * disabled field reads as broken, and the stored value is still there when the
 * feature comes back on. The custom-instructions text saves through the
 * settings header's global Save/Discard cluster; only the enable switches save
 * instantly.
 *
 * Reading replies aloud is NOT here. It is a property of the message being
 * sent, so it lives in the composer's mode menu; duplicating it as a stored
 * preference would give the same behaviour two sources of truth.
 */

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo, type ReactNode } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
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
const CUSTOM_INSTRUCTIONS_MAX_CHARS = 5000;

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
          loading={prefsLoading}
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

interface CustomInstructionsForm {
  customInstructions: string;
}

function CustomInstructionsSection({
  organizationId,
  gate,
  loading,
  savedInstructions,
}: {
  organizationId: string;
  gate: FeatureGate;
  loading: boolean;
  savedInstructions: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled, isPending: togglePending } =
    useSetCustomInstructionsEnabled();
  const { mutateAsync: upsert } = useUpsertMyPreferences();

  const schema = useMemo(
    () =>
      z.object({
        customInstructions: z
          .string()
          .max(
            CUSTOM_INSTRUCTIONS_MAX_CHARS,
            t('errors.tooLong', { max: CUSTOM_INSTRUCTIONS_MAX_CHARS }),
          ),
      }),
    [t],
  );

  const data = useMemo<CustomInstructionsForm | undefined>(() => {
    if (loading) return undefined;
    return { customInstructions: savedInstructions };
  }, [loading, savedInstructions]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. So this only persists and, when the write fails, throws the
  // translated line for the cluster to show.
  const save = useCallback(
    async (values: CustomInstructionsForm) => {
      try {
        await upsert({
          organizationId,
          customInstructions: values.customInstructions,
        });
      } catch (err) {
        console.error('[personalization] custom instructions save failed', err);
        throw new Error(t('errors.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsert],
  );

  const editor = useFormEditor<CustomInstructionsForm>({ data, schema, save });
  // Saving runs through the settings header's global Save/Discard cluster;
  // while the feature is off the field is inert, so nothing registers.
  useRegisterGroupedEditor(editor, { enabled: gate.effective });

  const {
    register,
    formState: { errors },
  } = editor.form;

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
          aria-label={t('page.customInstructionsToggle.label')}
          checked={gate.effective}
          disabled={togglePending}
          onCheckedChange={async (next) => {
            try {
              await setEnabled({ organizationId, enabled: next });
              toast({ title: t('toasts.preferencesUpdated') });
            } catch (error) {
              console.error('[personalization] toggle failed', error);
            }
          }}
        />
      }
    >
      {/* The instructions field exists only while the feature is on — the
          toggle hides it rather than showing a field nothing would read. The
          grouped save bar is gated on the same flag (above). */}
      {gate.effective && (
        <form onSubmit={editor.submit}>
          <Stack gap={2}>
            <Textarea
              aria-label={t('page.customInstructions.title')}
              placeholder={t('page.customInstructions.placeholder')}
              rows={5}
              // The textarea IS the section body — without this it sits in
              // the 20rem control column and dangles off the row's left edge.
              wideControl
              disabled={editor.isSaving}
              errorMessage={errors.customInstructions?.message}
              counterMax={CUSTOM_INSTRUCTIONS_MAX_CHARS}
              {...register('customInstructions')}
            />
          </Stack>
        </form>
      )}
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
      title={t('page.memoriesToggle.label')}
      description={description}
      action={
        <Switch
          aria-label={t('page.memoriesToggle.label')}
          checked={gate.effective}
          disabled={isPending}
          onCheckedChange={async (next) => {
            try {
              await setEnabled({ organizationId, enabled: next });
              toast({ title: t('toasts.preferencesUpdated') });
            } catch (error) {
              console.error('[personalization] toggle failed', error);
            }
          }}
        />
      }
    >
      {/* Same rule as every other section toggle: off means the section's
          content is gone, not shown-but-inert. */}
      {gate.effective && (
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
      )}
    </SettingsSection>
  );
}

/**
 * One memory list under a plain label. `entries` is `undefined` while the
 * memories backend has not answered — the list says nothing has loaded rather
 * than claiming the user has no memories. The lists are read-only until the
 * memory mutations exist behind the same seam that feeds them; a review
 * control that silently did nothing would be worse than none.
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
      <Text className="text-sm font-medium">{title}</Text>
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
