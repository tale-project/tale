'use client';

import { ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Alert } from '@/app/components/ui/feedback/alert';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { detectPii } from '@/convex/governance/pii/pii_detector';
import {
  BUILT_IN_PII_PATTERNS,
  getEnabledPatterns,
} from '@/convex/governance/pii/pii_patterns';
import { useT } from '@/lib/i18n/client';

import { useUpsertPiiConfig } from '../hooks/mutations';
import { usePiiConfig } from '../hooks/queries';

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

  const { data: policy, isLoading } = usePiiConfig(organizationId);
  const upsertMutation = useUpsertPiiConfig();

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
  const [initialized, setInitialized] = useState(false);

  // Sync from server data once loaded
  if (policy && !initialized) {
    setEnabled(policy.enabled ?? false);
    setMode(policy.config?.mode ?? 'mask');
    setEnabledPatterns(
      new Set<string>(policy.config?.enabledPatterns ?? PATTERN_NAMES),
    );
    setCustomPatterns(policy.config?.customPatterns ?? []);
    setInitialized(true);
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
        enabled: overrides.enabled ?? enabled,
        mode: overrides.mode ?? mode,
        enabledPatterns: overrides.enabledPatterns ?? [...enabledPatterns],
        customPatterns: (overrides.customPatterns ?? customPatterns).filter(
          (p) => p.name && p.regex && p.replacement,
        ),
      };
      try {
        await upsertMutation.mutateAsync(resolved);
        toast({ title: t('pii.saved'), variant: 'success' });
      } catch {
        toast({ title: t('pii.saveFailed'), variant: 'destructive' });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner aria-label={tCommon('actions.loading')} />
      </div>
    );
  }

  const modeOptions = [
    { value: 'mask', label: t('pii.modeMask') },
    { value: 'block', label: t('pii.modeBlock') },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <FormSection label={t('pii.title')} description={t('pii.description')}>
        <Switch
          label={t('pii.enableLabel')}
          description={t('pii.enableDescription')}
          checked={enabled}
          onCheckedChange={handleEnabledChange}
        />
      </FormSection>

      {enabled && (
        <>
          <FormSection label={t('pii.modeLabel')}>
            <Select
              label={t('pii.modeLabel')}
              options={modeOptions}
              value={mode}
              onValueChange={handleModeChange}
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
                />
                <Input
                  label={t('pii.customPatternRegex')}
                  value={editingPattern.regex}
                  onChange={(e) =>
                    handleEditingPatternChange('regex', e.target.value)
                  }
                  placeholder={t('pii.customPatternRegexPlaceholder')}
                />
                <Input
                  label={t('pii.customPatternReplacement')}
                  value={editingPattern.replacement}
                  onChange={(e) =>
                    handleEditingPatternChange('replacement', e.target.value)
                  }
                  placeholder={t('pii.customPatternReplacementPlaceholder')}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveCustomPattern}
                    disabled={
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
        </>
      )}
    </div>
  );
}
