'use client';

import { useMemo } from 'react';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import { Doc } from '@/convex/_generated/dataModel';
import { StopCircle } from 'lucide-react';
import { getStepIcon } from '../utils/step-icons';

interface AvailableStep {
  stepSlug: string;
  name: string;
  stepType?: Doc<'wfStepDefs'>['stepType'];
  actionType?: string;
}

interface NextStepsEditorProps {
  stepType: Doc<'wfStepDefs'>['stepType'];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  stepOptions: AvailableStep[];
  currentStepSlug?: string;
  disabled?: boolean;
}

const TRANSITION_KEYS_BY_TYPE: Record<Doc<'wfStepDefs'>['stepType'], string[]> =
  {
    trigger: ['success'],
    llm: ['success', 'failure'],
    condition: ['true', 'false'],
    action: ['success', 'failure'],
    loop: ['loop', 'done'],
  };

export function NextStepsEditor({
  stepType,
  value,
  onChange,
  stepOptions,
  currentStepSlug,
  disabled = false,
}: NextStepsEditorProps) {
  const { t } = useT('automations');

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
    <div className="space-y-2">
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
    </div>
  );
}
