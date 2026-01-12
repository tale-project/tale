'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FormDialog } from '@/components/ui/dialog/form-dialog';
import { DeleteStepDialog } from './step-delete-dialog';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/forms/input';
import { JsonInput } from '@/components/ui/forms/json-input';
import { HStack } from '@/components/ui/layout/layout';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/overlays/tooltip';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { z } from 'zod';
import { Play, Cpu, HelpCircle, CheckCircle2, Zap, Trash2 } from 'lucide-react';
import { Doc } from '@/convex/_generated/dataModel';

interface StepDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Doc<'wfStepDefs'> | null;
  onStepUpdated?: () => void;
}

export function StepDetailsDialog({
  open,
  onOpenChange,
  step,
  onStepUpdated: _onStepUpdated,
}: StepDetailsDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  // Memoized schema factory - validation messages are technical, not user-facing
  const getConfigSchema = useCallback((stepType: string) => {
    switch (stepType) {
      case 'action':
        return z.object({
          type: z.string().min(1),
          parameters: z.record(z.string(), z.any()).optional().default({}),
          retryPolicy: z
            .object({
              maxRetries: z.number().min(0).max(10),
              backoffMs: z.number().min(100).max(60000),
            })
            .optional(),
        });

      case 'llm':
        return z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          model: z.enum([
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-3.5-turbo',
            'claude-3-sonnet',
            'claude-3-haiku',
          ]),
          temperature: z.number().min(0).max(1).optional(),
          maxTokens: z.number().min(1).max(8192).optional(),
          systemPrompt: z.string().min(1),
          userPrompt: z.string().optional(),
          tools: z.array(z.string()).optional().default([]),
          outputFormat: z.enum(['text', 'json']).optional().default('text'),
          contextVariables: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .optional()
            .default({}),
        });

      case 'condition':
        return z
          .object({
            expression: z.string().optional(),
            rule: z.record(z.string(), z.any()).optional(),
            description: z.string().optional(),
            variables: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
          })
          .refine((data) => data.expression || data.rule, {
            path: ['expression'],
          });

      case 'trigger':
        return z.discriminatedUnion('type', [
          z.object({
            type: z.literal('manual'),
            data: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
            context: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
          }),
          z.object({
            type: z.literal('schedule'),
            schedule: z.string().min(1),
            timezone: z.string().optional(),
            context: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
          }),
          z.object({
            type: z.literal('webhook'),
            webhookData: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
            headers: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
            context: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
          }),
          z.object({
            type: z.literal('event'),
            eventType: z.string().min(1),
            eventData: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
            context: z
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
              .optional()
              .default({}),
          }),
        ]);

      default:
        return z.object({});
    }
  }, []);
  const [editedName, setEditedName] = useState('');
  const [config, setConfig] = useState<string>('{}');
  const [nameError, setNameError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Mutations (temporarily disabled; step editing is read-only until public APIs exist)
  // const updateStep = useMutation(api.wf_step_defs.updateStep);
  // const deleteStep = useMutation(api.wf_step_defs.deleteStep);

  // Get schema for current step type
  const configSchema = step ? getConfigSchema(step.stepType) : undefined;

  const getIcon = (stepType: string) => {
    switch (stepType) {
      case 'trigger':
        return <Play className="size-6" />;
      case 'llm':
        return <Cpu className="size-6" />;
      case 'condition':
        return <HelpCircle className="size-6" />;
      case 'approval':
        return <CheckCircle2 className="size-6" />;
      case 'action':
        return <Zap className="size-6" />;
      default:
        return <div className="size-6 rounded-full bg-muted" />;
    }
  };

  const getStepTypeColor = (stepType: string) => {
    switch (stepType) {
      case 'trigger':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
      case 'llm':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800';
      case 'condition':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';

      case 'action':
        return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  // Validate step name
  const validateStepName = (name: string) => {
    if (!name.trim()) {
      setNameError(t('stepDetails.validation.nameRequired'));
      return false;
    }

    const stepNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    if (!stepNamePattern.test(name.trim())) {
      setNameError(t('stepDetails.validation.nameFormat'));
      return false;
    }

    setNameError('');
    return true;
  };

  // Initialize form data when step changes
  useEffect(() => {
    if (step) {
      setEditedName(step.name);
      setNameError(''); // Clear any previous errors

      // For action steps, extract the type from config and show remaining config
      if (
        step.stepType === 'action' &&
        step.config &&
        typeof step.config === 'object'
      ) {
        const config = step.config as { type?: string; [key: string]: unknown };

        // Remove type from config for display
        const { type: _type, ...configWithoutType } = config;
        setConfig(JSON.stringify(configWithoutType, null, 2));
      } else {
        setConfig(JSON.stringify(step.config, null, 2));
      }
    }
  }, [step]);

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step) return;

    // Validate step name
    if (!validateStepName(editedName)) {
      return;
    }

    // Step editing is currently read-only until public Convex mutations are available.
    toast({
      title: t('stepDetails.toast.editNotAvailable'),
      description: t('stepDetails.toast.apiNotReady'),
    });

    return;
  };

  const handleDelete = async () => {
    if (!step) return;

    // Step deletion is currently disabled until public Convex mutations are available.
    toast({
      title: t('stepDetails.toast.deleteNotAvailable'),
      description: t('stepDetails.toast.apiNotReady'),
    });

    setShowDeleteConfirm(false);
  };

  if (!step) return null;

  const customHeader = (
    <HStack gap={3}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`p-2 rounded-lg ${getStepTypeColor(step.stepType)}`}
            >
              {getIcon(step.stepType)}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('stepDetails.stepTypeTooltip', { type: step.stepType })}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1">
        <span className="text-lg font-semibold">{step.name}</span>
      </div>
    </HStack>
  );

  const customFooter = (
    <div className="flex gap-2 w-full">
      {step.stepType !== 'trigger' && (
        <Button
          type="button"
          variant="destructive"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isLoading}
          className="mr-auto"
        >
          <Trash2 className="size-4 mr-1" />
          {tCommon('actions.delete')}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleClose}
        disabled={isLoading}
        className="flex-1"
      >
        {tCommon('actions.cancel')}
      </Button>
      <Button
        type="submit"
        disabled={!editedName.trim() || isLoading}
        className="flex-1"
      >
        {isLoading ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
      </Button>
    </div>
  );

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={handleClose}
        title={step.name}
        isSubmitting={isLoading}
        submitDisabled={!editedName.trim()}
        onSubmit={handleSubmit}
        customHeader={customHeader}
        customFooter={customFooter}
        large
      >
        <Input
          id="step-name"
          label={tCommon('labels.name')}
          required
          value={editedName}
          onChange={(e) => {
            setEditedName(e.target.value);
            if (nameError) validateStepName(e.target.value);
          }}
          onBlur={(e) => validateStepName(e.target.value)}
          placeholder="analyze_data"
          disabled={isLoading}
          errorMessage={nameError}
        />
        <JsonInput
          id="step-config"
          label={t('stepDetails.configLabel')}
          value={config}
          schema={configSchema}
          onChange={setConfig}
          placeholder=""
          rows={4}
          disabled={isLoading}
        />
      </FormDialog>

      <DeleteStepDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        step={step}
        onConfirm={handleDelete}
        isLoading={isLoading}
      />
    </>
  );
}
