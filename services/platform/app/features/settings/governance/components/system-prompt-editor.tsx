'use client';

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  effectiveMandatoryInstructions,
  type SystemPromptConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';

interface SystemPromptEditorProps {
  organizationId: string;
}

interface SystemPromptForm {
  mandatoryInstructions: string;
}

// Matches the `systemPromptConfigSchema` field bound in
// lib/shared/schemas/governance.ts so the client never accepts text the
// server-side parse would reject.
const MAX_CHARS = 20_000;

interface SavedInstructions {
  /** The stored flag, or `undefined` when the policy predates it. */
  storedEnabled: boolean | undefined;
  /** The stored text, resolved across the legacy prefix/suffix pair. */
  text: string;
}

/**
 * Read the stored text and flag out of a raw `system_prompt` config.
 *
 * The text is resolved with the flag stripped: `effectiveMandatoryInstructions`
 * answers "what gets injected", which is nothing while the section is off — but
 * the editor must still show (and preserve) the draft an admin turned off.
 */
function readSavedInstructions(rawConfig: unknown): SavedInstructions {
  const config = isRecord(rawConfig) ? rawConfig : {};
  const str = (value: unknown) =>
    typeof value === 'string' ? value : undefined;
  const text =
    effectiveMandatoryInstructions({
      mandatoryInstructions: str(config.mandatoryInstructions),
      mandatoryPrefixPrompt: str(config.mandatoryPrefixPrompt),
      mandatorySuffixPrompt: str(config.mandatorySuffixPrompt),
    }) ?? '';
  return {
    storedEnabled:
      typeof config.enabled === 'boolean' ? config.enabled : undefined,
    text,
  };
}

// =============================================================================
// Single editor — owns data fetching, the form controller, the instant-save
// section toggle, save/toast wiring, and the loading state. Renders the REAL
// layout once, always, wrapped in `<Skeletonize>`. The skeleton-aware
// `<Textarea>` masks itself to its exact `rows={4}` height while loading. Route
// loaders warm `system_prompt` so warm navigations skip the skeleton entirely.
// Saving the text goes through the settings header's global Save/Discard cluster
// (registered via the editor group); the toggle saves instantly.
//
// The field carries no label or description of its own: the section header names
// the feature and explains it, so a second label would say the same thing twice.
// The textarea keeps an `aria-label` so the bare control is still named.
// =============================================================================
export function SystemPromptEditor({
  organizationId,
}: SystemPromptEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'system_prompt',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const schema = useMemo(
    () =>
      z.object({
        mandatoryInstructions: z
          .string()
          .max(MAX_CHARS, t('systemPrompt.charLimitExceeded')),
      }),
    [t],
  );

  // Pre-cutover policy files carry a mandatory prefix/suffix pair instead of
  // the unified field; resolve whichever shape is on disk into the one
  // editable value. Saving writes only the unified field — the whole config
  // is replaced on save, which retires the legacy pair for that org.
  const saved = useMemo(
    () => readSavedInstructions(policy?.config),
    [policy?.config],
  );

  // Absent flag means "decide from the text": an org that configured
  // instructions before the toggle existed keeps them on, a fresh org (no text)
  // reads off. Only an explicit `false` silences configured text.
  const savedEnabled = saved.storedEnabled ?? saved.text.trim().length > 0;

  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'system_prompt',
    savedEnabled,
    isLoading,
    // Turning the section off must not lose the draft — the stored text is
    // written back alongside the flag.
    buildConfig: (next): SystemPromptConfig => ({
      enabled: next,
      mandatoryInstructions: saved.text,
    }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('systemPrompt.saveFailed'),
  });

  const data = useMemo<SystemPromptForm | undefined>(() => {
    if (isLoading) return undefined;
    return { mandatoryInstructions: saved.text };
  }, [isLoading, saved.text]);

  const save = useCallback(
    async (values: SystemPromptForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'system_prompt',
          // The form exists only while the section is on, so a batched save
          // always means on.
          config: {
            enabled: true,
            mandatoryInstructions: values.mandatoryInstructions.trim(),
          } satisfies SystemPromptConfig,
        });
        toast({
          title: t('toastSavedTitle'),
          description: t('systemPrompt.saved'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('systemPrompt.saveFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [organizationId, t, toast, upsertMutation],
  );

  const editor = useFormEditor<SystemPromptForm>({
    data,
    schema,
    save,
  });
  // Saving runs through the settings header's global Save/Discard cluster; a
  // section that is off has no field to save, so nothing registers.
  useRegisterGroupedEditor(editor, { enabled });

  const {
    register,
    formState: { errors },
  } = editor.form;

  return (
    <Skeletonize loading={isLoading} label={t('systemPrompt.title')}>
      <SettingsSection
        title={t('systemPrompt.title')}
        description={t('systemPrompt.description')}
        action={
          <Switch
            aria-label={t('systemPrompt.enabled')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={isToggling || editor.isSaving}
          />
        }
      >
        {/* The field exists only while the section is on — the toggle hides it
            rather than showing a textarea nothing would read. It stays mounted
            (masked) while loading so the skeleton keeps the section's real
            shape; `enabled` is only known once the read settles. */}
        {(isLoading || enabled) && (
          <form onSubmit={editor.submit}>
            <fieldset disabled={editor.isLoading} className="contents">
              <Stack gap={2}>
                <Textarea
                  placeholder={t('systemPrompt.instructionsPlaceholder')}
                  rows={4}
                  aria-label={t('systemPrompt.title')}
                  errorMessage={errors.mandatoryInstructions?.message}
                  counterMax={MAX_CHARS}
                  {...register('mandatoryInstructions')}
                />
              </Stack>
            </fieldset>
          </form>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
