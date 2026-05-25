'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { EditorActions, useFormEditor } from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

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
    form: {
      register,
      handleSubmit,
      watch,
      formState: { errors },
    },
  } = editor;
  const prefixValue = watch('mandatoryPrefixPrompt') ?? '';
  const suffixValue = watch('mandatorySuffixPrompt') ?? '';

  const skeleton = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex max-w-2xl flex-col gap-12">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mb-2 h-4 w-96 max-w-full" />
          <Skeleton className="h-[100px] w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mb-2 h-4 w-96 max-w-full" />
          <Skeleton className="h-[100px] w-full rounded-md" />
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  return (
    <PageSection
      title={t('systemPrompt.title')}
      description={t('systemPrompt.description')}
    >
      <form id={FORM_ID} onSubmit={handleSubmit((values) => save(values))}>
        <fieldset disabled={editor.isLoading} className="contents">
          <Stack gap={6} className="max-w-2xl">
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
                {t('systemPrompt.charCount', {
                  count: prefixValue.length,
                  max: MAX_CHARS,
                })}
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
                {t('systemPrompt.charCount', {
                  count: suffixValue.length,
                  max: MAX_CHARS,
                })}
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
    </PageSection>
  );
}
