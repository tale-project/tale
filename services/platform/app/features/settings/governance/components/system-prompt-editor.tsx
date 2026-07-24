'use client';

import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { effectiveMandatoryInstructions } from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

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

// =============================================================================
// Single editor — owns data fetching, the form controller, save/toast wiring,
// and the loading state. Renders the REAL layout once, always, wrapped in
// `<Skeletonize>`. The skeleton-aware `<Textarea>` masks itself to its exact
// `rows={4}` height while loading. Route loaders warm `system_prompt` so warm
// navigations skip the skeleton entirely. Saving goes through the settings
// header's global Save/Discard cluster (registered via the editor group).
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
  const data = useMemo<SystemPromptForm | undefined>(() => {
    if (isLoading) return undefined;
    const config = isRecord(policy?.config) ? policy.config : {};
    const resolved = effectiveMandatoryInstructions({
      mandatoryInstructions:
        typeof config.mandatoryInstructions === 'string'
          ? config.mandatoryInstructions
          : undefined,
      mandatoryPrefixPrompt:
        typeof config.mandatoryPrefixPrompt === 'string'
          ? config.mandatoryPrefixPrompt
          : undefined,
      mandatorySuffixPrompt:
        typeof config.mandatorySuffixPrompt === 'string'
          ? config.mandatorySuffixPrompt
          : undefined,
    });
    return { mandatoryInstructions: resolved ?? '' };
  }, [isLoading, policy]);

  const save = useCallback(
    async (values: SystemPromptForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'system_prompt',
          config: {
            mandatoryInstructions: values.mandatoryInstructions.trim(),
          },
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
  useRegisterGroupedEditor(editor);

  const {
    register,
    watch,
    formState: { errors },
  } = editor.form;
  const instructionsValue = watch('mandatoryInstructions') ?? '';

  return (
    <Skeletonize loading={isLoading} label={t('systemPrompt.title')}>
      <SettingsSection
        title={t('systemPrompt.title')}
        description={t('systemPrompt.description')}
      >
        <form onSubmit={editor.submit}>
          <fieldset disabled={editor.isLoading} className="contents">
            <Stack gap={6}>
              <FormSection
                label={t('systemPrompt.instructionsLabel')}
                description={t('systemPrompt.instructionsDescription')}
              >
                <Textarea
                  placeholder={t('systemPrompt.instructionsPlaceholder')}
                  rows={4}
                  aria-label={t('systemPrompt.instructionsLabel')}
                  errorMessage={errors.mandatoryInstructions?.message}
                  {...register('mandatoryInstructions')}
                />
                <Text variant="muted" className="text-xs">
                  <SkeletonBox>
                    {t('systemPrompt.charCount', {
                      count: instructionsValue.length,
                      max: MAX_CHARS,
                    })}
                  </SkeletonBox>
                </Text>
              </FormSection>
            </Stack>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
