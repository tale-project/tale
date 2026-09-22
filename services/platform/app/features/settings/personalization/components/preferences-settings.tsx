'use client';

/**
 * User preferences — the custom-instructions feature as one section that owns
 * both its switch and its field.
 *
 * The switch lives in the section header (unlabelled — the section title
 * names the feature; the switch carries an aria-label) and the field lives in
 * the section body. Turning the feature off HIDES the section's body — a
 * disabled field reads as broken, and the stored value is still there when the
 * feature comes back on. The custom-instructions text saves through the
 * settings header's global Save/Discard cluster; only the enable switch saves
 * instantly.
 *
 * Memories are NOT here. The backend keeps its store and approval gate
 * (`domains/chat/memories.ts`), but nothing proposes a memory today, and
 * whether the chat assistant should keep any is an open product decision —
 * so the page shows no switch that would promise one.
 *
 * Reading replies aloud is NOT here either. It is a property of the message
 * being sent, so it lives in the composer's mode menu; duplicating it as a
 * stored preference would give the same behaviour two sources of truth.
 */

import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Textarea } from '@tale/ui/textarea';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useMemo, type ReactNode } from 'react';
import { z } from 'zod';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useSetCustomInstructionsEnabled,
  useUpsertMyPreferences,
} from '../hooks/mutations';

/** Backend cap, mirrored so the counter and the field agree with the writer. */
const CUSTOM_INSTRUCTIONS_MAX_CHARS = 5000;

/**
 * A feature is on when the user said so, and follows the org's default when
 * they have not. Both states are shown, so "on" and "on because your org says
 * so" never look the same. The chat turn resolves the same cascade server-side
 * (`getEffectiveCustomInstructions`), so what the switch says is what the
 * assistant does.
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

  const { data: prefs, isLoading: prefsLoading } = useBackendQuery(
    'user_preferences/queries:getMyPreferences',
    { organizationId },
  );
  const { data: instructionsPolicy } = useGovernancePolicy(
    organizationId,
    'custom_instructions',
  );

  const instructionsGate = resolveGate(
    prefs?.customInstructionsEnabled,
    policyEnabled(instructionsPolicy?.config),
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
