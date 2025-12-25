'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { JsonInput } from '@/components/ui/json-input';
import { toast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface CreateStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateStep: (data: {
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Doc<'wfStepDefs'>['config'];
    nextSteps?: Doc<'wfStepDefs'>['nextSteps'];
  }) => Promise<void>;
}

const getDefaultTemplates = (
  stepType: Doc<'wfStepDefs'>['stepType'],
): { config: string } => {
  switch (stepType) {
    case 'trigger': {
      const cfg = { type: 'manual', context: {} };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
    case 'llm': {
      const cfg = {
        name: 'LLM Analysis',
        model: 'gpt-4o',
        temperature: 0.2,
        maxTokens: 1000,
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Analyze the following data: {{input_data}}',
        outputFormat: 'text',
        tools: [],
        contextVariables: {},
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
    case 'condition': {
      const cfg = {
        expression: '{{score}} > 0.7',
        description: 'Check if score is above threshold',
        variables: {},
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }

    case 'action':
    default: {
      const cfg = {
        type: 'log',
        parameters: { message: 'Hello from action step' },
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
  }
};

export default function CreateStepDialog({
  open,
  onOpenChange,
  onCreateStep,
  // selectedWorkflow is not used - commented out to prevent unused variable warning
}: CreateStepDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const initialDefaults = getDefaultTemplates('action');

  const [formData, setFormData] = useState({
    name: '',
    stepType: 'action' as Doc<'wfStepDefs'>['stepType'],
    config: initialDefaults.config,
    nextSteps: '{}',
  });
  const [nameError, setNameError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // Validate step name
  const validateStepName = (name: string) => {
    if (!name.trim()) {
      setNameError(t('createStep.validation.nameRequired'));
      return false;
    }

    const stepNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    if (!stepNamePattern.test(name.trim())) {
      setNameError(t('createStep.validation.nameFormat'));
      return false;
    }

    setNameError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate step name
    if (!validateStepName(formData.name)) {
      return;
    }

    try {
      setIsLoading(true);

      // Parse JSON fields
      let parsedConfig: Doc<'wfStepDefs'>['config'] = {};
      let parsedNextSteps: Doc<'wfStepDefs'>['nextSteps'] = {};

      if (formData.config.trim()) {
        try {
          parsedConfig = JSON.parse(formData.config);
        } catch {
          toast({
            title: t('configuration.validation.invalidJson'),
            variant: 'destructive',
          });
          return;
        }
      }

      if (formData.nextSteps.trim()) {
        try {
          parsedNextSteps = JSON.parse(formData.nextSteps);
        } catch {
          toast({
            title: t('configuration.validation.invalidJson'),
            variant: 'destructive',
          });
          return;
        }
      }

      await onCreateStep({
        name: formData.name.trim(),
        stepType: formData.stepType,
        config: parsedConfig,
        nextSteps: parsedNextSteps,
      });

      // Reset form
      const defaults = getDefaultTemplates('action');
      setFormData({
        name: '',
        stepType: 'action',
        config: defaults.config,
        nextSteps: '{}',
      });
      setNameError('');

      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create step:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
      // Reset form when closing
      const defaults = getDefaultTemplates('action');
      setFormData({
        name: '',
        stepType: 'action',
        config: defaults.config,
        nextSteps: '{}',
      });
      setNameError('');
    }
  };

  const handleTypeChange = (value: string) => {
    const type = value as Doc<'wfStepDefs'>['stepType'];
    const defaults = getDefaultTemplates(type);
    setFormData((prev) => ({
      ...prev,
      stepType: type,
      config: defaults.config,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="sticky top-0">
            <DialogTitle>{t('createStep.title')}</DialogTitle>
            <DialogDescription>
              {t('createStep.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="step-name">
                {t('configuration.name')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="step-name"
                value={formData.name}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, name: e.target.value }));
                  if (nameError) validateStepName(e.target.value);
                }}
                onBlur={(e) => validateStepName(e.target.value)}
                placeholder={t('createStep.namePlaceholder')}
                disabled={isLoading}
                className={nameError ? 'border-red-500' : ''}
              />
              {nameError && <p className="text-xs text-red-500">{nameError}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('createStep.type')}</Label>
              <Select
                value={formData.stepType}
                onValueChange={handleTypeChange}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="action">{t('createStep.types.action')}</SelectItem>
                  <SelectItem value="llm">{t('createStep.types.llm')}</SelectItem>
                  <SelectItem value="condition">{t('createStep.types.condition')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <JsonInput
                id="step-config"
                label={t('createStep.configLabel')}
                value={formData.config}
                onChange={(value) =>
                  setFormData((prev) => ({ ...prev, config: value }))
                }
                placeholder='{"key":"value"}'
                rows={4}
                disabled={isLoading}
                description={t('createStep.configDescription')}
              />

              <JsonInput
                id="step-next"
                label={t('createStep.nextStepsLabel')}
                value={formData.nextSteps}
                onChange={(value) =>
                  setFormData((prev) => ({ ...prev, nextSteps: value }))
                }
                placeholder='{"onSuccess":"step-2","onFailure":"step-x"}'
                rows={3}
                disabled={isLoading}
                description={t('createStep.nextStepsDescription')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              className="flex-1"
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              className="flex-1"
              type="submit"
              disabled={!formData.name.trim() || isLoading}
            >
              {isLoading ? t('createStep.creating') : t('createStep.createButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Export the trigger button component as well
export function CreateStepTrigger({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useT('automations');
  return (
    <Button className="w-full" onClick={onClick} disabled={disabled}>
      <Plus className="size-4 mr-2" />
      {t('createStep.createButton')}
    </Button>
  );
}
