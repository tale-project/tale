'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface SystemPromptEditorProps {
  organizationId: string;
}

const MAX_CHARS = 10_000;

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

  const savedConfig = useMemo(() => {
    if (!policy)
      return { mandatoryPrefixPrompt: '', mandatorySuffixPrompt: '' };
    const config = isRecord(policy.config) ? policy.config : {};
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
  }, [policy]);

  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');

  useEffect(() => {
    setPrefix(savedConfig.mandatoryPrefixPrompt);
    setSuffix(savedConfig.mandatorySuffixPrompt);
  }, [savedConfig]);

  const hasChanges =
    prefix !== savedConfig.mandatoryPrefixPrompt ||
    suffix !== savedConfig.mandatorySuffixPrompt;

  const prefixOverLimit = prefix.length > MAX_CHARS;
  const suffixOverLimit = suffix.length > MAX_CHARS;
  const canSave =
    hasChanges &&
    !upsertMutation.isPending &&
    !prefixOverLimit &&
    !suffixOverLimit;

  const handleSave = useCallback(async () => {
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'system_prompt',
        config: {
          mandatoryPrefixPrompt: prefix.trim(),
          mandatorySuffixPrompt: suffix.trim(),
        },
      });
      toast({
        title: t('toastSavedTitle'),
        description: t('systemPrompt.saved'),
        variant: 'success',
      });
    } catch {
      toast({
        title: t('toastSaveFailedTitle'),
        description: t('systemPrompt.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [organizationId, prefix, suffix, upsertMutation, toast, t]);

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
      action={
        hasChanges ? (
          <Button onClick={handleSave} disabled={!canSave} size="sm">
            {upsertMutation.isPending
              ? t('systemPrompt.saving')
              : t('systemPrompt.save')}
          </Button>
        ) : undefined
      }
    >
      <Stack gap={6} className="max-w-2xl">
        <FormSection
          label={t('systemPrompt.prefixLabel')}
          description={t('systemPrompt.prefixDescription')}
        >
          <Textarea
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder={t('systemPrompt.prefixPlaceholder')}
            rows={4}
            aria-label={t('systemPrompt.prefixLabel')}
            errorMessage={
              prefixOverLimit ? t('systemPrompt.charLimitExceeded') : undefined
            }
          />
          <Text variant="muted" className="text-xs">
            {t('systemPrompt.charCount', {
              count: prefix.length,
              max: MAX_CHARS,
            })}
          </Text>
        </FormSection>

        <FormSection
          label={t('systemPrompt.suffixLabel')}
          description={t('systemPrompt.suffixDescription')}
        >
          <Textarea
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            placeholder={t('systemPrompt.suffixPlaceholder')}
            rows={4}
            aria-label={t('systemPrompt.suffixLabel')}
            errorMessage={
              suffixOverLimit ? t('systemPrompt.charLimitExceeded') : undefined
            }
          />
          <Text variant="muted" className="text-xs">
            {t('systemPrompt.charCount', {
              count: suffix.length,
              max: MAX_CHARS,
            })}
          </Text>
        </FormSection>
      </Stack>
    </PageSection>
  );
}
