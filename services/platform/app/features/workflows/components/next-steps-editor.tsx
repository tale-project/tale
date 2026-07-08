'use client';

import { Stack } from '@tale/ui/layout';
import { StopCircle } from 'lucide-react';
import { useMemo } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';

import { getStepIcon, type StepType } from '../utils/step-icons';

interface AvailableStep {
  stepSlug: string;
  name: string;
  stepType?: StepType;
  actionType?: string;
}

interface NextStepsEditorProps {
  stepType: StepType;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  stepOptions: AvailableStep[];
  currentStepSlug?: string;
  disabled?: boolean;
}

const TRANSITION_KEYS_BY_TYPE: Record<StepType, string[]> = {
  start: ['success'],
  trigger: ['success'],
  llm: ['success', 'failure'],
  condition: ['true', 'false'],
  action: ['success', 'failure'],
  loop: ['loop', 'done'],
  output: [],
  sandbox: ['success'],
};

export function NextStepsEditor({
  stepType,
  value,
  onChange,
  stepOptions,
  currentStepSlug,
  disabled = false,
}: NextStepsEditorProps) {
  const { t } = useT('workflows');

  const transitionKeys = TRANSITION_KEYS_BY_TYPE[stepType] || ['success'];

  const selectOptions = useMemo(() => {
    const options: Array<{
      value: string;
      label: string;
      icon?: React.ReactNode;
    }> = [
      {
        value: 'noop',
        label: t('nextSteps.endWorkflow'),
        icon: <StopCircle className="size-4 shrink-0" />,
      },
    ];

    stepOptions
      .filter((s) => s.stepSlug !== currentStepSlug)
      .forEach((step) => {
        options.push({
          value: step.stepSlug,
          label: step.name,
          icon: getStepIcon(step.stepType, step.actionType),
        });
      });

    return options;
  }, [stepOptions, currentStepSlug, t]);

  const handleTransitionChange = (key: string, targetSlug: string) => {
    const newValue = { ...value };
    newValue[key] = targetSlug;
    onChange(newValue);
  };

  return (
    <Stack gap={2}>
      {transitionKeys.map((key) => (
        <Select
          key={key}
          label={t(`nextSteps.transitions.${key}`)}
          value={value[key] || 'noop'}
          onValueChange={(v) => handleTransitionChange(key, v)}
          options={selectOptions}
          disabled={disabled}
        />
      ))}
    </Stack>
  );
}
