'use client';

import { JsonInput } from '@/app/components/ui/forms/json-input';
import {
  Sparkles,
  TestTubeDiagonal,
  Workflow,
  Trash2,
  Save,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/overlays/tooltip';
import { cn } from '@/lib/utils/cn';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { AutomationTester } from './automation-tester';
import { AutomationAssistant } from './automation-assistant';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { useUpdateStep } from '../hooks/use-update-step';
import { useStepValidation } from '../hooks/use-step-validation';
import { toast } from '@/app/hooks/use-toast';
import { NextStepsEditor } from './next-steps-editor';
import { getStepIcon } from '../utils/step-icons';

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
  const [isSaving, setIsSaving] = useState(false);
  const updateStep = useUpdateStep();

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
      setEditedNextSteps(step.nextSteps as Record<string, string>);
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

  const handleSave = useCallback(async () => {
    if (!step || !parsedEditedConfig || !isValid) return;

    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = { config: parsedEditedConfig };
      if (isNextStepsDirty) {
        updates.nextSteps = editedNextSteps;
      }
      await updateStep({
        stepRecordId: step._id,
        updates,
        editMode: 'json',
      });
      toast({
        title: t('sidePanel.stepSaved'),
        variant: 'default',
      });
    } catch (error) {
      console.error('Failed to save step:', error);
      toast({
        title: t('sidePanel.stepSaveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
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
      style={{ '--panel-width': `${width}px` } as React.CSSProperties}
      className="bg-background border-l border-border flex flex-col flex-[0_0_auto] min-h-0 relative overflow-hidden w-(--panel-width) max-md:w-full max-md:absolute max-md:inset-0 max-md:z-10"
    >
      {/* Resize handle - hidden on mobile */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-10 max-md:hidden',
          'hover:bg-border transition-colors',
        )}
      >
        <div className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2" />
      </div>

      {/* Panel header */}
      <div className="bg-background/70 backdrop-blur-sm p-3 border-b border-border shrink-0 sticky top-0">
        <div className="flex items-center gap-3">
          {showAIChat ? (
            <>
              <div className="p-2 rounded-lg bg-purple-600 text-white dark:bg-purple-700">
                <Sparkles className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('sidePanel.aiAssistant')}
                </h2>
              </div>
            </>
          ) : showTestPanel ? (
            <>
              <div className="p-2 rounded-lg border bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <TestTubeDiagonal className="size-4" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground">
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
                        (step.config as Record<string, unknown>)?.type as
                          | string
                          | undefined,
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
                <h2 className="text-sm font-semibold text-foreground">
                  {step.name}
                </h2>
              </div>
            </>
          ) : null}
          {/* Desktop action buttons */}
          {showAIChat && canClearChat && (
            <div className="hidden md:flex items-center shrink-0">
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
          <div className="flex items-center gap-1 md:hidden shrink-0">
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
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
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
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-1">
                  <AlertCircle className="size-4" />
                  {t('sidePanel.validationErrors')}
                </div>
                <ul className="text-xs text-destructive space-y-1">
                  {errors.map((error) => (
                    <li key={error}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium mb-1">
                  <AlertTriangle className="size-4" />
                  {t('sidePanel.validationWarnings')}
                </div>
                <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1">
                  {warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t bg-background p-3 flex">
            <Button
              onClick={handleSave}
              disabled={!isDirty || !isValid || isSaving || isValidating}
              size="sm"
              className="flex-1"
            >
              <Save className="size-4 mr-1" />
              {isSaving ? t('sidePanel.saving') : tCommon('actions.save')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
