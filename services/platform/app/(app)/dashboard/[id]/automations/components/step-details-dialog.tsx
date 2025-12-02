'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DeleteStepDialog from './delete-step-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JsonInput } from '@/components/ui/json-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { z } from 'zod';
import { Play, Cpu, HelpCircle, CheckCircle2, Zap, Trash2 } from 'lucide-react';
import { Doc } from '@/convex/_generated/dataModel';
interface StepDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Doc<'wfStepDefs'> | null;
  onStepUpdated?: () => void;
}

const getConfigSchema = (stepType: string) => {
  switch (stepType) {
    case 'action':
      return z.object({
        type: z.string().min(1, 'Action type is required'),
        parameters: z.record(z.string(), z.any()).optional().default({}),
        retryPolicy: z
          .object({
            maxRetries: z
              .number()
              .min(0, 'Max retries must be non-negative')
              .max(10, 'Max retries cannot exceed 10'),
            backoffMs: z
              .number()
              .min(100, 'Backoff must be at least 100ms')
              .max(60000, 'Backoff cannot exceed 60 seconds'),
          })
          .optional(),
      });

    case 'llm':
      return z.object({
        name: z.string().min(1, 'LLM step name is required'),
        description: z.string().optional(),
        model: z.enum(
          [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-3.5-turbo',
            'claude-3-sonnet',
            'claude-3-haiku',
          ],
          {
            message:
              'Model must be one of: gpt-4o, gpt-4o-mini, gpt-3.5-turbo, claude-3-sonnet, claude-3-haiku',
          },
        ),
        temperature: z
          .number()
          .min(0, 'Temperature must be between 0 and 1')
          .max(1, 'Temperature must be between 0 and 1')
          .optional(),
        maxTokens: z
          .number()
          .min(1, 'Max tokens must be positive')
          .max(8192, 'Max tokens cannot exceed 8192')
          .optional(),
        systemPrompt: z.string().min(1, 'System prompt is required'),
        userPrompt: z.string().optional(),
        tools: z.array(z.string()).optional().default([]),
        outputFormat: z
          .enum(['text', 'json'], {
            message: 'Output format must be either "text" or "json"',
          })
          .optional()
          .default('text'),
        conversational: z.boolean().optional().default(false),
        contextVariables: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
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
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
        })
        .refine((data) => data.expression || data.rule, {
          message: 'Either expression or rule must be provided',
          path: ['expression'],
        });

    case 'trigger':
      return z.discriminatedUnion('type', [
        z.object({
          type: z.literal('manual'),
          data: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
          context: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
        }),
        z.object({
          type: z.literal('schedule'),
          schedule: z.string().min(1, 'Schedule (cron expression) is required'),
          timezone: z.string().optional(),
          context: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
        }),
        z.object({
          type: z.literal('webhook'),
          webhookData: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
          headers: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
          context: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
        }),
        z.object({
          type: z.literal('event'),
          eventType: z.string().min(1, 'Event type is required'),
          eventData: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
          context: z
            .record(
              z.string(),
              z.union([z.string(), z.number(), z.boolean(), z.null()]),
            )
            .optional()
            .default({}),
        }),
      ]);

    default:
      return z.object({});
  }
};

export default function StepDetailsDialog({
  open,
  onOpenChange,
  step,
  onStepUpdated,
}: StepDetailsDialogProps) {
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
      setNameError('Step name is required');
      return false;
    }

    const stepNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    if (!stepNamePattern.test(name.trim())) {
      setNameError('Format: letters, numbers, "_", "-"');
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
      title: 'Step editing not yet available',
      description:
        'Public APIs for editing workflow steps are not wired up yet.',
    });

    return;
  };

  const handleDelete = async () => {
    if (!step) return;

    // Step deletion is currently disabled until public Convex mutations are available.
    toast({
      title: 'Step deletion not yet available',
      description:
        'Public APIs for editing workflow steps are not wired up yet.',
    });

    setShowDeleteConfirm(false);
  };

  if (!step) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg !p-0">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="sticky top-0 bg-background shadow-sm px-6 py-4 rounded-t-2xl">
              <div className="flex items-center gap-3">
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
                      <p>{step.stepType} step</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="flex-1">
                  <DialogTitle className="text-lg">{step.name}</DialogTitle>
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-4 max-h-[70vh] overflow-y-auto py-4 px-6">
              <div className="space-y-2">
                <Label htmlFor="step-name">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="step-name"
                  value={editedName}
                  onChange={(e) => {
                    setEditedName(e.target.value);
                    if (nameError) validateStepName(e.target.value);
                  }}
                  onBlur={(e) => validateStepName(e.target.value)}
                  placeholder="analyze_data"
                  disabled={isLoading}
                  className={nameError ? 'border-red-500' : ''}
                />
                {nameError && (
                  <p className="text-xs text-red-500">{nameError}</p>
                )}
              </div>
              <JsonInput
                id="step-config"
                label="Config (JSON)"
                value={config}
                schema={configSchema}
                onChange={setConfig}
                placeholder=""
                rows={4}
                disabled={isLoading}
              />
            </div>

            <DialogFooter className="gap-2 px-6 py-4">
              {step.stepType !== 'trigger' && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isLoading}
                  className="mr-auto"
                >
                  <Trash2 className="size-4 mr-1" />
                  Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!editedName.trim() || isLoading}>
                {isLoading ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
