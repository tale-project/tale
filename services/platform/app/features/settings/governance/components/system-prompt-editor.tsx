'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
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

type SystemPromptController = ReturnType<
  typeof useFormEditor<SystemPromptForm>
>;

// =============================================================================
// Plain presentational view — no data/state hooks of its own. Renders the real
// layout from an injected form `controller`. Rendered both live (by the
// container) and as its own skeleton (the container wraps it in
// `<Skeletonize>`), so the loading and loaded layouts are the SAME tree and
// cannot drift. The skeleton-aware `<Textarea>` masks itself to its exact
// `rows={4}` height while loading.
// =============================================================================
export function SystemPromptEditorView({
  controller,
  onSave,
}: {
  controller: SystemPromptController;
  onSave: (values: SystemPromptForm) => Promise<void>;
}) {
  const { t } = useT('governance');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = controller.form;
  const prefixValue = watch('mandatoryPrefixPrompt') ?? '';
  const suffixValue = watch('mandatorySuffixPrompt') ?? '';

  return (
    <PageSection
      title={t('systemPrompt.title')}
      description={t('systemPrompt.description')}
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSave)}>
        <fieldset disabled={controller.isLoading} className="contents">
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
                controller={controller}
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

// =============================================================================
// Container — owns data fetching, the form controller, save/toast wiring, and
// the loading state. Wraps the plain view in `<Skeletonize>` so the same tree
// renders the skeleton. Route loaders warm `system_prompt` so warm navigations
// skip the skeleton entirely.
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

  return (
    <Skeletonize loading={isLoading} label={t('systemPrompt.title')}>
      <SystemPromptEditorView controller={editor} onSave={save} />
    </Skeletonize>
  );
}
