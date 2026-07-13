'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { EditorActions, useFormEditor } from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface SystemPromptEditorProps {
  organizationId: string;
}

interface SystemPromptForm {
  mandatoryPrefixPrompt: string;
  mandatorySuffixPrompt: string;
}

const MAX_CHARS = 10_000;
const FORM_ID = 'governance-system-prompt-form';

// =============================================================================
// Single editor — owns data fetching, the form controller, save/toast wiring,
// and the loading state. Renders the REAL layout once, always, wrapped in
// `<Skeletonize>`. The skeleton-aware `<Textarea>` masks itself to its exact
// `rows={4}` height while loading. Route loaders warm `system_prompt` so warm
// navigations skip the skeleton entirely.
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
        mandatoryPrefixPrompt: z
          .string()
          .max(MAX_CHARS, t('systemPrompt.charLimitExceeded')),
        mandatorySuffixPrompt: z
          .string()
          .max(MAX_CHARS, t('systemPrompt.charLimitExceeded')),
      }),
    [t],
  );

  const data = useMemo<SystemPromptForm | undefined>(() => {
    if (isLoading) return undefined;
    const config = isRecord(policy?.config) ? policy.config : {};
    return {
      mandatoryPrefixPrompt:
        typeof config.mandatoryPrefixPrompt === 'string'
          ? config.mandatoryPrefixPrompt
          : '',
      mandatorySuffixPrompt:
        typeof config.mandatorySuffixPrompt === 'string'
          ? config.mandatorySuffixPrompt
          : '',
    };
  }, [isLoading, policy]);

  const save = useCallback(
    async (values: SystemPromptForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'system_prompt',
          config: {
            mandatoryPrefixPrompt: values.mandatoryPrefixPrompt.trim(),
            mandatorySuffixPrompt: values.mandatorySuffixPrompt.trim(),
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

  const {
    register,
    watch,
    formState: { errors },
  } = editor.form;
  const prefixValue = watch('mandatoryPrefixPrompt') ?? '';
  const suffixValue = watch('mandatorySuffixPrompt') ?? '';

  return (
    <Skeletonize loading={isLoading} label={t('systemPrompt.title')}>
      <SettingsSection
        title={t('systemPrompt.title')}
        description={t('systemPrompt.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset disabled={editor.isLoading} className="contents">
            {/* Full section width (not max-w-2xl): sits above Default Models
                on Content & models, so the textareas and the Discard/Save
                cluster must share the same right edge as "+ Add rule". */}
            <Stack gap={6}>
              <FormSection
                label={t('systemPrompt.prefixLabel')}
                description={t('systemPrompt.prefixDescription')}
              >
                <Textarea
                  placeholder={t('systemPrompt.prefixPlaceholder')}
                  rows={4}
                  aria-label={t('systemPrompt.prefixLabel')}
                  errorMessage={errors.mandatoryPrefixPrompt?.message}
                  {...register('mandatoryPrefixPrompt')}
                />
                <Text variant="muted" className="text-xs">
                  <SkeletonBox>
                    {t('systemPrompt.charCount', {
                      count: prefixValue.length,
                      max: MAX_CHARS,
                    })}
                  </SkeletonBox>
                </Text>
              </FormSection>

              <FormSection
                label={t('systemPrompt.suffixLabel')}
                description={t('systemPrompt.suffixDescription')}
              >
                <Textarea
                  placeholder={t('systemPrompt.suffixPlaceholder')}
                  rows={4}
                  aria-label={t('systemPrompt.suffixLabel')}
                  errorMessage={errors.mandatorySuffixPrompt?.message}
                  {...register('mandatorySuffixPrompt')}
                />
                <Text variant="muted" className="text-xs">
                  <SkeletonBox>
                    {t('systemPrompt.charCount', {
                      count: suffixValue.length,
                      max: MAX_CHARS,
                    })}
                  </SkeletonBox>
                </Text>
              </FormSection>

              <HStack justify="end">
                <EditorActions
                  controller={editor}
                  formId={FORM_ID}
                  entityKind="governance_system_prompt"
                />
              </HStack>
            </Stack>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}
