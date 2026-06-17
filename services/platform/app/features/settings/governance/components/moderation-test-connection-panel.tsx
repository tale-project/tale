'use client';

import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

import { useTestModerationProvider } from '../hooks/mutations';
import { TestResultView, type TestResult } from './moderation-test-result-view';

interface TestConnectionPanelProps {
  organizationId: string;
  disabled: boolean;
}

export function TestConnectionPanel({
  organizationId,
  disabled,
}: TestConnectionPanelProps) {
  const { t } = useT('governance');
  const testMutation = useTestModerationProvider();
  const [text, setText] = useState(t('moderationProvider.testDefaultText'));
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setResult(null);
    try {
      const r = await testMutation.mutateAsync({
        organizationId,
        text,
      });
      setResult(r);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({
        ok: false,
        kind: 'step_error',
        errorClass: 'unknown',
        hint: message,
      });
    }
  };

  return (
    <FormSection
      label={t('moderationProvider.testConnection')}
      description={t('moderationProvider.testConnectionDescription')}
    >
      <div className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('moderationProvider.testPlaceholder')}
          rows={3}
          disabled={disabled || testMutation.isPending}
        />
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runTest()}
            disabled={
              disabled || testMutation.isPending || text.trim().length === 0
            }
          >
            {testMutation.isPending
              ? t('moderationProvider.testing')
              : t('moderationProvider.runTest')}
          </Button>
        </div>
        {result && <TestResultView result={result} />}
      </div>
    </FormSection>
  );
}
