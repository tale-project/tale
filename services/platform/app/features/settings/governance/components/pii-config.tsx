'use client';

import { BUILT_IN_PATTERN_NAMES } from '@tale/pii';
import { Button } from '@tale/ui/button';
import { PiiPlayground } from '@tale/ui/pii-playground';
import { Skeleton } from '@tale/ui/skeleton';
import { useCallback, useRef, useState } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

const PATTERN_NAMES: readonly string[] = BUILT_IN_PATTERN_NAMES;

// Default replacement tokens for the built-in patterns. Mirrors the
// `@tale/pii` defaults — pinned here so the admin UI can show each
// pattern's mask token without instantiating the factory.
const DEFAULT_REPLACEMENTS: Record<string, string> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  creditCard: '[CREDIT_CARD]',
  cvc: '[CVC]',
  iban: '[IBAN]',
  ipAddress: '[IP_ADDRESS]',
  ssn: '[SSN]',
  dateOfBirth: '[DATE_OF_BIRTH]',
  address: '[ADDRESS]',
  nationalId: '[NATIONAL_ID]',
};

interface CustomPattern {
  name: string;
  regex: string;
  replacement: string;
}

interface PiiConfigProps {
  organizationId: string;
}

export function PiiConfig({ organizationId }: PiiConfigProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'pii_config',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'mask' | 'block' | 'tokenize'>('tokenize');
  const [enabledPatterns, setEnabledPatterns] = useState(
    new Set(PATTERN_NAMES),
  );
  const [customPatterns, setCustomPatterns] = useState<CustomPattern[]>([]);
  const [editingPattern, setEditingPattern] = useState<CustomPattern | null>(
    null,
  );

  const cannotManage = ability.cannot('write', 'orgSettings');
  const initializedRef = useRef(false);

  // Sync from server data once loaded (render-time to avoid flicker)
  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    if (policy) {
      setEnabled(policy.enabled ?? false);
      setMode(policy.config?.mode ?? 'tokenize');
      setEnabledPatterns(
        new Set<string>(policy.config?.enabledPatterns ?? PATTERN_NAMES),
      );
      setCustomPatterns(policy.config?.customPatterns ?? []);
    }
  }

  const saveConfig = useCallback(
    async (overrides: {
      enabled?: boolean;
      mode?: 'mask' | 'block' | 'tokenize';
      enabledPatterns?: string[];
      customPatterns?: CustomPattern[];
    }) => {
      const resolved = {
        organizationId,
        policyType: 'pii_config' as const,
        config: {
          enabled: overrides.enabled ?? enabled,
          mode: overrides.mode ?? mode,
          enabledPatterns: overrides.enabledPatterns ?? [...enabledPatterns],
          customPatterns: (overrides.customPatterns ?? customPatterns).filter(
            (p) => p.name && p.regex && p.replacement,
          ),
        },
      };
      try {
        await upsertMutation.mutateAsync(resolved);
        toast({
          title: t('toastSavedTitle'),
          description: t('pii.saved'),
          variant: 'success',
        });
      } catch (error: unknown) {
        const description =
          error instanceof Error ? error.message : t('pii.saveFailed');
        toast({
          title: t('toastSaveFailedTitle'),
          description,
          variant: 'destructive',
        });
      }
    },
    [
      upsertMutation,
      organizationId,
      enabled,
      mode,
      enabledPatterns,
      customPatterns,
      toast,
      t,
    ],
  );

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      void saveConfig({ enabled: checked });
    },
    [saveConfig],
  );

  const handleModeChange = useCallback(
    (v: string) => {
      if (v === 'mask' || v === 'block' || v === 'tokenize') {
        setMode(v);
        void saveConfig({ mode: v });
      }
    },
    [saveConfig],
  );

  const handlePatternToggle = useCallback(
    (patternName: string, checked: boolean) => {
      setEnabledPatterns((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(patternName);
        } else {
          next.delete(patternName);
        }
        void saveConfig({ enabledPatterns: [...next] });
        return next;
      });
    },
    [saveConfig],
  );

  const handleAddCustomPattern = useCallback(() => {
    setEditingPattern({ name: '', regex: '', replacement: '' });
  }, []);

  const handleEditingPatternChange = useCallback(
    (field: keyof CustomPattern, value: string) => {
      setEditingPattern((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [],
  );

  const handleSaveCustomPattern = useCallback(() => {
    if (!editingPattern) return;
    if (
      !editingPattern.name ||
      !editingPattern.regex ||
      !editingPattern.replacement
    ) {
      return;
    }
    const updated = [...customPatterns, editingPattern];
    setCustomPatterns(updated);
    setEditingPattern(null);
    void saveConfig({ customPatterns: updated });
  }, [editingPattern, customPatterns, saveConfig]);

  const handleCancelCustomPattern = useCallback(() => {
    setEditingPattern(null);
  }, []);

  const handleRemoveCustomPattern = useCallback(
    (index: number) => {
      const updated = customPatterns.filter((_, i) => i !== index);
      setCustomPatterns(updated);
      void saveConfig({ customPatterns: updated });
    },
    [customPatterns, saveConfig],
  );

  const skeleton = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
        </div>
      </div>
      {enabled && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-8 w-56 rounded-md" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-80 max-w-full" />
            <div className="mt-1 flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-[1.15rem] w-8 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isLoading || !initializedRef.current) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  const modeOptions = [
    { value: 'tokenize', label: t('pii.modeTokenize') },
    { value: 'mask', label: t('pii.modeMask') },
    { value: 'block', label: t('pii.modeBlock') },
  ];

  return (
    <PageSection
      title={t('pii.title')}
      description={t('pii.description')}
      action={
        <Switch
          label={t('pii.enableLabel')}
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      {enabled && (
        <div className="flex flex-col gap-6">
          <FormSection label={t('pii.modeLabel')}>
            <Select
              label={t('pii.modeLabel')}
              options={modeOptions}
              value={mode}
              onValueChange={handleModeChange}
              disabled={cannotManage}
            />
          </FormSection>

          <FormSection
            label={t('pii.patternsTitle')}
            description={t('pii.patternsDescription')}
          >
            <div className="flex flex-col gap-2">
              {BUILT_IN_PATTERN_NAMES.map((name) => (
                <Switch
                  key={name}
                  label={t(`pii.patterns.${name}`)}
                  description={DEFAULT_REPLACEMENTS[name] ?? ''}
                  checked={enabledPatterns.has(name)}
                  onCheckedChange={(checked) =>
                    handlePatternToggle(name, checked)
                  }
                  disabled={cannotManage}
                />
              ))}
            </div>
          </FormSection>

          <FormSection
            label={t('pii.customPatternsTitle')}
            description={t('pii.customPatternsDescription')}
          >
            {customPatterns.map((cp, index) => (
              <div
                key={index}
                className="border-border flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{cp.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {cp.regex}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRemoveCustomPattern(index)}
                  disabled={cannotManage}
                >
                  {tCommon('actions.delete')}
                </Button>
              </div>
            ))}
            {editingPattern && (
              <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
                <Input
                  label={t('pii.customPatternName')}
                  value={editingPattern.name}
                  onChange={(e) =>
                    handleEditingPatternChange('name', e.target.value)
                  }
                  placeholder={t('pii.customPatternNamePlaceholder')}
                  disabled={cannotManage}
                />
                <Input
                  label={t('pii.customPatternRegex')}
                  value={editingPattern.regex}
                  onChange={(e) =>
                    handleEditingPatternChange('regex', e.target.value)
                  }
                  placeholder={t('pii.customPatternRegexPlaceholder')}
                  disabled={cannotManage}
                />
                <Input
                  label={t('pii.customPatternReplacement')}
                  value={editingPattern.replacement}
                  onChange={(e) =>
                    handleEditingPatternChange('replacement', e.target.value)
                  }
                  placeholder={t('pii.customPatternReplacementPlaceholder')}
                  disabled={cannotManage}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveCustomPattern}
                    disabled={
                      cannotManage ||
                      !editingPattern.name ||
                      !editingPattern.regex ||
                      !editingPattern.replacement
                    }
                  >
                    {tCommon('actions.save')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleCancelCustomPattern}
                  >
                    {tCommon('actions.cancel')}
                  </Button>
                </div>
              </div>
            )}
            {!editingPattern && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddCustomPattern}
                disabled={cannotManage}
              >
                {t('pii.addCustomPattern')}
              </Button>
            )}
          </FormSection>

          <FormSection
            label={t('pii.testAreaTitle')}
            description={t('pii.testAreaDescription')}
          >
            {/*
              The playground replaces the old single-shot "test detection"
              tool. It walks an admin through the full life of a message —
              detection, tokenization, AI round-trip, restoration — so the
              effect of the in-progress config is visible end to end before
              they save. The same component is reused in Storybook. The
              `piiPlayground` / `piiTypes` namespaces it consumes ship from
              `@tale/ui` directly, so we just mount it here.
            */}
            <PiiPlayground
              mode={mode}
              onModeChange={handleModeChange}
              detectionLocales="*"
            />
          </FormSection>
        </div>
      )}
    </PageSection>
  );
}
