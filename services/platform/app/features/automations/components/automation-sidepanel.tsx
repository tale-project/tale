'use client';

import {
  Sparkles,
  TestTubeDiagonal,
  Workflow,
  Trash2,
  Save,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useUpdateStep } from '../hooks/mutations';
import { useStepValidation } from '../hooks/queries';
import { getStepIcon } from '../utils/step-icons';
import { AutomationAssistant } from './automation-assistant';
import { AutomationTester } from './automation-tester';
import { NextStepsEditor } from './next-steps-editor';

interface AutomationSidePanelProps {
  step: Doc<'wfStepDefs'> | null;
  isOpen: boolean;
  onClose: () => void;
  showAIChat?: boolean;
  showTestPanel?: boolean;
  automationId?: Id<'wfDefinitions'>;
  organizationId?: string;
  stepOptions?: Array<{
    stepSlug: string;
    name: string;
    stepType?: Doc<'wfStepDefs'>['stepType'];
    actionType?: string;
  }>;
}

const getStepTypeColor = (stepType: string) => {
  switch (stepType) {
    case 'start':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
    case 'llm':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300';
    case 'condition':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    case 'loop':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300';
    case 'action':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

export function AutomationSidePanel({
  step,
  isOpen,
  onClose,
  showAIChat = false,
  showTestPanel = false,
  automationId,
  organizationId,
  stepOptions = [],
}: AutomationSidePanelProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const [width, setWidth] = useState(384); // 96 * 4 = 384px (w-96)
  const [isResizing, setIsResizing] = useState(false);
  const [canClearChat, setCanClearChat] = useState(false);
  const clearChatRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [editedConfig, setEditedConfig] = useState<string>('');
  const [editedNextSteps, setEditedNextSteps] = useState<
    Record<string, string>
  >({});
  const { mutate: updateStep, isPending: isSaving } = useUpdateStep();

  const originalConfigJson = useMemo(
    () => (step?.config ? JSON.stringify(step.config, null, 2) : '{}'),
    [step?.config],
  );

  const originalNextStepsJson = useMemo(
    () => (step?.nextSteps ? JSON.stringify(step.nextSteps) : '{}'),
    [step?.nextSteps],
  );

  const isConfigDirty =
    editedConfig !== originalConfigJson && editedConfig !== '';
  const isNextStepsDirty =
    JSON.stringify(editedNextSteps) !== originalNextStepsJson;
  const isDirty = isConfigDirty || isNextStepsDirty;

  useEffect(() => {
    if (step?.config) {
      setEditedConfig(JSON.stringify(step.config, null, 2));
    }
    if (step?.nextSteps) {
      setEditedNextSteps(step.nextSteps);
    } else {
      setEditedNextSteps({});
    }
  }, [step?._id, step?.config, step?.nextSteps]);

  const parsedEditedConfig = useMemo(() => {
    try {
      return JSON.parse(editedConfig || '{}');
    } catch {
      return null;
    }
  }, [editedConfig]);

  const validationConfig = useMemo(() => {
    if (!step || !parsedEditedConfig) return null;
    return {
      stepSlug: step.stepSlug,
      name: step.name,
      stepType: step.stepType,
      config: parsedEditedConfig,
    };
  }, [step, parsedEditedConfig]);

  const { isValid, errors, warnings, isValidating } = useStepValidation(
    validationConfig,
    automationId,
  );

  const handleConfigChange = useCallback((value: string) => {
    setEditedConfig(value);
  }, []);

  const handleSave = useCallback(() => {
    if (!step || !parsedEditedConfig || !isValid) return;

    const updates: Record<string, unknown> = { config: parsedEditedConfig };
    if (isNextStepsDirty) {
      updates.nextSteps = editedNextSteps;
    }
    updateStep(
      {
        stepRecordId: step._id,
        updates,
        editMode: 'json',
      },
      {
        onSuccess: () => {
          toast({
            title: t('sidePanel.stepSaved'),
            variant: 'default',
          });
        },
        onError: (error) => {
          console.error('Failed to save step:', error);
          toast({
            title: t('sidePanel.stepSaveFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [
    step,
    parsedEditedConfig,
    isValid,
    isNextStepsDirty,
    editedNextSteps,
    updateStep,
    t,
  ]);

  const handleClearChatStateChange = useCallback(
    (canClear: boolean, clearFn: () => void) => {
      setCanClearChat(canClear);
      clearChatRef.current = clearFn;
    },
    [],
  );

  const handleClearChat = useCallback(() => {
    clearChatRef.current?.();
  }, []);

  const MIN_WIDTH = 280; // ~70 in tailwind
  const MAX_WIDTH = 600; // ~150 in tailwind

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const panelRect = panelRef.current.getBoundingClientRect();
      const newWidth = panelRect.right - e.clientX;

      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, MIN_WIDTH, MAX_WIDTH]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      style={{ '--panel-width': `${width}px` }}
      className="bg-background border-border relative flex min-h-0 w-(--panel-width) flex-[0_0_auto] flex-col overflow-hidden border-l max-md:absolute max-md:inset-0 max-md:z-10 max-md:w-full"
    >
      {/* Resize handle - hidden on mobile */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-10 max-md:hidden',
          'hover:bg-border transition-colors',
        )}
      >
        <div className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2" />
      </div>

      {/* Panel header */}
      <div className="bg-background/70 border-border sticky top-0 shrink-0 border-b p-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {showAIChat ? (
            <>
              <div className="rounded-lg bg-purple-600 p-2 text-white dark:bg-purple-700">
                <Sparkles className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-foreground text-sm font-semibold">
                  {t('sidePanel.aiAssistant')}
                </h2>
              </div>
            </>
          ) : showTestPanel ? (
            <>
              <div className="rounded-lg border bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <TestTubeDiagonal className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-foreground text-sm font-semibold">
                  {t('sidePanel.testAutomation')}
                </h2>
              </div>
            </>
          ) : step ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'p-2 rounded-lg border',
                        getStepTypeColor(step.stepType),
                      )}
                    >
                      {getStepIcon(
                        step.stepType,
                        'type' in step.config
                          ? String(step.config.type)
                          : undefined,
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {t('sidePanel.stepTooltip', { stepType: step.stepType })}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex-1">
                <h2 className="text-foreground text-sm font-semibold">
                  {step.name}
                </h2>
              </div>
            </>
          ) : null}
          {/* Desktop action buttons */}
          {showAIChat && canClearChat && (
            <div className="hidden shrink-0 items-center md:flex">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleClearChat}
                aria-label={tCommon('actions.delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
          {/* Mobile action buttons */}
          <div className="flex shrink-0 items-center gap-1 md:hidden">
            {showAIChat && canClearChat && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={handleClearChat}
                aria-label={tCommon('actions.delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button
              size="icon"
              className="size-8"
              onClick={onClose}
              aria-label={t('sidePanel.viewAutomation')}
            >
              <Workflow className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Panel content */}
      {showTestPanel && automationId && organizationId ? (
        <AutomationTester
          organizationId={organizationId}
          automationId={automationId}
        />
      ) : showAIChat && organizationId ? (
        <AutomationAssistant
          automationId={automationId}
          organizationId={organizationId}
          onClearChatStateChange={handleClearChatStateChange}
        />
      ) : step ? (
        <>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
            <JsonInput
              value={editedConfig}
              onChange={handleConfigChange}
              indentWidth={2}
              rows={10}
            />

            <NextStepsEditor
              stepType={step.stepType}
              value={editedNextSteps}
              onChange={setEditedNextSteps}
              stepOptions={stepOptions}
              currentStepSlug={step.stepSlug}
            />

            {errors.length > 0 && (
              <div className="border-destructive/50 bg-destructive/10 rounded-md border p-3">
                <div className="text-destructive mb-1 flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="size-4" />
                  {t('sidePanel.validationErrors')}
                </div>
                <ul className="text-destructive space-y-1 text-xs">
                  {errors.map((error, index) => (
                    <li key={`${error}-${index}`}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-4" />
                  {t('sidePanel.validationWarnings')}
                </div>
                <ul className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
                  {warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="bg-background flex shrink-0 border-t p-3">
            <Button
              onClick={handleSave}
              disabled={!isDirty || !isValid || isSaving || isValidating}
              size="sm"
              className="flex-1"
            >
              <Save className="mr-1 size-4" />
              {isSaving ? t('sidePanel.saving') : tCommon('actions.save')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
