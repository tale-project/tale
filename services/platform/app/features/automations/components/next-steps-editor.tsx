'use client';

import { useMemo } from 'react';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import { Doc } from '@/convex/_generated/dataModel';
import {
  Zap,
  Cpu,
  HelpCircle,
  Repeat,
  Users,
  MessageSquare,
  Package,
  FileText,
  Plug,
  Variable,
  Database,
  Mail,
  Send,
  ClipboardList,
  CheckCircle,
  Mic,
  Cloud,
  Globe,
  Layout,
  GitBranch,
  Settings,
  StopCircle,
} from 'lucide-react';

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
  availableSteps: AvailableStep[];
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

const iconClass = 'size-4 shrink-0';

const getActionIcon = (actionType?: string) => {
  switch (actionType) {
    case 'customer':
      return <Users className={iconClass} />;
    case 'conversation':
      return <MessageSquare className={iconClass} />;
    case 'product':
      return <Package className={iconClass} />;
    case 'document':
      return <FileText className={iconClass} />;
    case 'integration':
      return <Plug className={iconClass} />;
    case 'set_variables':
      return <Variable className={iconClass} />;
    case 'rag':
      return <Database className={iconClass} />;
    case 'imap':
      return <Mail className={iconClass} />;
    case 'email_provider':
      return <Send className={iconClass} />;
    case 'workflow_processing_records':
      return <ClipboardList className={iconClass} />;
    case 'approval':
      return <CheckCircle className={iconClass} />;
    case 'tone_of_voice':
      return <Mic className={iconClass} />;
    case 'onedrive':
      return <Cloud className={iconClass} />;
    case 'crawler':
    case 'website':
      return <Globe className={iconClass} />;
    case 'websitePages':
      return <Layout className={iconClass} />;
    case 'workflow':
      return <GitBranch className={iconClass} />;
    default:
      return <Settings className={iconClass} />;
  }
};

const getStepIcon = (
  stepType?: Doc<'wfStepDefs'>['stepType'],
  actionType?: string,
) => {
  switch (stepType) {
    case 'trigger':
      return <Zap className={iconClass} />;
    case 'llm':
      return <Cpu className={iconClass} />;
    case 'condition':
      return <HelpCircle className={iconClass} />;
    case 'loop':
      return <Repeat className={iconClass} />;
    case 'action':
      return getActionIcon(actionType);
    default:
      return null;
  }
};

export function NextStepsEditor({
  stepType,
  value,
  onChange,
  availableSteps,
  currentStepSlug,
  disabled = false,
}: NextStepsEditorProps) {
  const { t } = useT('automations');

  const transitionKeys = TRANSITION_KEYS_BY_TYPE[stepType] || ['success'];

  const stepOptions = useMemo(() => {
    const options: Array<{
      value: string;
      label: string;
      icon?: React.ReactNode;
    }> = [
      {
        value: 'noop',
        label: t('nextSteps.endWorkflow'),
        icon: <StopCircle className={iconClass} />,
      },
    ];

    availableSteps
      .filter((s) => s.stepSlug !== currentStepSlug)
      .forEach((step) => {
        options.push({
          value: step.stepSlug,
          label: step.name,
          icon: getStepIcon(step.stepType, step.actionType),
        });
      });

    return options;
  }, [availableSteps, currentStepSlug, t]);

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
          options={stepOptions}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
