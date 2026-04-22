'use client';

import { ShieldCheck } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Alert } from '@/app/components/ui/feedback/alert';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { detectPii } from '@/convex/governance/pii/pii_detector';
import {
  BUILT_IN_PII_PATTERNS,
  getEnabledPatterns,
} from '@/convex/governance/pii/pii_patterns';
import { useT } from '@/lib/i18n/client';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

const PATTERN_NAMES = BUILT_IN_PII_PATTERNS.map((p) => p.name);

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
  const [mode, setMode] = useState<'mask' | 'block'>('mask');
  const [enabledPatterns, setEnabledPatterns] = useState(
    new Set(PATTERN_NAMES),
  );
  const [customPatterns, setCustomPatterns] = useState<CustomPattern[]>([]);
  const [editingPattern, setEditingPattern] = useState<CustomPattern | null>(
    null,
  );
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<ReturnType<
    typeof detectPii
  > | null>(null);

  const cannotManage = ability.cannot('write', 'orgSettings');
  const initializedRef = useRef(false);

  // Sync from server data once loaded (render-time to avoid flicker)
  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    if (policy) {
      setEnabled(policy.enabled ?? false);
      setMode(policy.config?.mode ?? 'mask');
      setEnabledPatterns(
        new Set<string>(policy.config?.enabledPatterns ?? PATTERN_NAMES),
      );
      setCustomPatterns(policy.config?.customPatterns ?? []);
    }
  }

  const saveConfig = useCallback(
    async (overrides: {
      enabled?: boolean;
      mode?: 'mask' | 'block';
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
      if (v === 'mask' || v === 'block') {
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

  const handleTest = useCallback(() => {
    if (!testText.trim()) {
      setTestResults(null);
      return;
    }

    const builtIn = getEnabledPatterns([...enabledPatterns]);
    const custom = customPatterns
      .filter((p) => p.name && p.regex && p.replacement)
      .map((p) => ({
        name: p.name,
        regex: new RegExp(p.regex, 'g'),
        replacement: p.replacement,
      }));

    const allPatterns = [...builtIn, ...custom];
    setTestResults(detectPii(testText, allPatterns));
  }, [testText, enabledPatterns, customPatterns]);

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
              {BUILT_IN_PII_PATTERNS.map((pattern) => (
                <Switch
                  key={pattern.name}
                  label={t(`pii.patterns.${pattern.name}`)}
                  description={pattern.replacement}
                  checked={enabledPatterns.has(pattern.name)}
                  onCheckedChange={(checked) =>
                    handlePatternToggle(pattern.name, checked)
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
            <Textarea
              label={t('pii.testInput')}
              value={testText}
              onChange={(e) => {
                setTestText(e.target.value);
                setTestResults(null);
              }}
              placeholder={t('pii.testInputPlaceholder')}
              rows={4}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={!testText.trim()}
            >
              {t('pii.testButton')}
            </Button>
            {testResults && testResults.length > 0 && (
              <Alert
                icon={ShieldCheck}
                variant="warning"
                title={t('pii.testResultsTitle')}
              >
                <div className="mt-2 flex flex-col gap-1">
                  {testResults.map((match, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge variant="orange">{match.patternName}</Badge>
                      <span className="text-sm">
                        &quot;{match.matchedText}&quot;
                      </span>
                    </div>
                  ))}
                </div>
              </Alert>
            )}
            {testResults && testResults.length === 0 && (
              <Alert icon={ShieldCheck} title={t('pii.testNoResults')} />
            )}
          </FormSection>
        </div>
      )}
    </PageSection>
  );
}
