'use client';

import {
  TestTubeDiagonal,
  X,
  Save,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';

import { PanelHeader } from '@/app/components/layout/panel-header';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useUpdateStep } from '../hooks/mutations';
import { useStepValidation } from '../hooks/queries';
import { useResizable } from '../hooks/use-resizable';
import { getStepIcon } from '../utils/step-icons';
import { AutomationTester } from './automation-tester';
import { NextStepsEditor } from './next-steps-editor';

interface AutomationSidePanelProps {
  step: Doc<'wfStepDefs'> | null;
  isOpen: boolean;
  onClose: () => void;
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

interface EditState {
  config: string;
  nextSteps: Record<string, string>;
}

interface ValidationMessagesProps {
  errors: string[];
  warnings: string[];
  errorLabel: string;
  warningLabel: string;
}

const ValidationMessages = memo(function ValidationMessages({
  errors,
  warnings,
  errorLabel,
  warningLabel,
}: ValidationMessagesProps) {
  const uniqueErrors = useMemo(() => [...new Set(errors)], [errors]);
  const uniqueWarnings = useMemo(() => [...new Set(warnings)], [warnings]);

  return (
    <>
      {uniqueErrors.length > 0 && (
        <div className="border-destructive/50 bg-destructive/10 rounded-md border p-3">
          <Text variant="error" className="mb-1 flex items-center gap-2">
            <AlertCircle className="size-4" />
            {errorLabel}
          </Text>
          <ul role="list" className="text-destructive space-y-1 text-xs">
            {uniqueErrors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {uniqueWarnings.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <Text
            as="div"
            className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-4" />
            {warningLabel}
          </Text>
          <ul
            role="list"
            className="space-y-1 text-xs text-amber-600 dark:text-amber-400"
          >
            {uniqueWarnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
});

interface StepEditorContentProps {
  step: Doc<'wfStepDefs'>;
  editState: EditState;
  onConfigChange: (value: string) => void;
  onNextStepsChange: (value: Record<string, string>) => void;
  onSave: () => void;
  isSaving: boolean;
  isValid: boolean;
  isDirty: boolean;
  errors: string[];
  warnings: string[];
  stepOptions: Array<{
    stepSlug: string;
    name: string;
    stepType?: Doc<'wfStepDefs'>['stepType'];
    actionType?: string;
  }>;
}

const StepEditorContent = memo(function StepEditorContent({
  step,
  editState,
  onConfigChange,
  onNextStepsChange,
  onSave,
  isSaving,
  isValid,
  isDirty,
  errors,
  warnings,
  stepOptions,
}: StepEditorContentProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  return (
    <>
      <VStack gap={4} className="flex-1 overflow-y-auto p-3">
        <JsonInput
          value={editState.config}
          onChange={onConfigChange}
          indentWidth={2}
          rows={10}
        />

        <NextStepsEditor
          stepType={step.stepType}
          value={editState.nextSteps}
          onChange={onNextStepsChange}
          stepOptions={stepOptions}
          currentStepSlug={step.stepSlug}
        />

        <ValidationMessages
          errors={errors}
          warnings={warnings}
          errorLabel={t('sidePanel.validationErrors')}
          warningLabel={t('sidePanel.validationWarnings')}
        />
      </VStack>

      <HStack className="bg-background shrink-0 border-t p-3">
        <Button
          onClick={onSave}
          disabled={isSaving || !isValid || !isDirty}
          size="sm"
          className="flex-1"
        >
          <Save className="mr-1 size-4" />
          {isSaving ? t('sidePanel.saving') : tCommon('actions.save')}
        </Button>
      </HStack>
    </>
  );
});

const EMPTY_STEP_OPTIONS: NonNullable<AutomationSidePanelProps['stepOptions']> =
  [];

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
  showTestPanel = false,
  automationId,
  organizationId,
  stepOptions = EMPTY_STEP_OPTIONS,
}: AutomationSidePanelProps) {
  const { t } = useT('automations');
  const panelRef = useRef<HTMLDivElement>(null);
  const { width, minWidth, maxWidth, handleMouseDown, handleKeyDown } =
    useResizable(panelRef);

  const [editState, setEditState] = useState<EditState>({
    config: '',
    nextSteps: {},
  });
  const { mutate: updateStep, isPending: isSaving } = useUpdateStep();

  const originalNextStepsJson = useMemo(
    () => (step?.nextSteps ? JSON.stringify(step.nextSteps) : '{}'),
    [step?.nextSteps],
  );

  const originalConfigJson = useMemo(
    () => (step?.config ? JSON.stringify(step.config, null, 2) : ''),
    [step?.config],
  );

  const isConfigDirty = editState.config !== originalConfigJson;

  const isNextStepsDirty =
    JSON.stringify(editState.nextSteps) !== originalNextStepsJson;

  const isDirty = isConfigDirty || isNextStepsDirty;

  useEffect(() => {
    setEditState({
      config: step?.config ? JSON.stringify(step.config, null, 2) : '',
      nextSteps: step?.nextSteps ?? {},
    });
  }, [step?._id, step?.config, step?.nextSteps]);

  const parsedEditedConfig = useMemo(() => {
    try {
      return JSON.parse(editState.config || '{}');
    } catch {
      return null;
    }
  }, [editState.config]);

  const validationConfig = useMemo(() => {
    if (!step || !parsedEditedConfig) return null;
    return {
      stepSlug: step.stepSlug,
      name: step.name,
      stepType: step.stepType,
      config: parsedEditedConfig,
    };
  }, [step, parsedEditedConfig]);

  const { isValid, errors, warnings } = useStepValidation(
    validationConfig,
    automationId,
  );

  const handleConfigChange = useCallback((value: string) => {
    setEditState((prev) => ({ ...prev, config: value }));
  }, []);

  const handleNextStepsChange = useCallback((value: Record<string, string>) => {
    setEditState((prev) => ({ ...prev, nextSteps: value }));
  }, []);

  const handleSave = useCallback(() => {
    if (!step || !parsedEditedConfig || !isValid || !isDirty) return;

    const updates: Record<string, unknown> = { config: parsedEditedConfig };
    if (isNextStepsDirty) {
      updates.nextSteps = editState.nextSteps;
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
    isDirty,
    isNextStepsDirty,
    editState.nextSteps,
    updateStep,
    t,
  ]);

  if (!isOpen) return null;

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={
        showTestPanel
          ? t('sidePanel.testAutomation')
          : (step?.name ?? t('sidePanel.stepEditor'))
      }
      style={{ '--panel-width': `${width}px` }}
      className="bg-background border-border relative flex min-h-0 w-(--panel-width) flex-[0_0_auto] flex-col overflow-hidden border-l max-md:absolute max-md:inset-0 max-md:z-10 max-md:w-full"
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidePanel.resizePanel')}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-51 max-md:hidden',
          'hover:bg-border focus-visible:ring-2 focus-visible:ring-ring transition-colors',
        )}
      >
        <div className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2" />
      </div>

      <PanelHeader variant="compact" className="gap-3">
        {showTestPanel ? (
          <>
            <div className="rounded-lg border bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <TestTubeDiagonal className="size-4" />
            </div>
            <div className="flex-1">
              <Heading level={2} size="sm">
                {t('sidePanel.testAutomation')}
              </Heading>
            </div>
          </>
        ) : step ? (
          <>
            <Tooltip
              content={
                <p>{t('sidePanel.stepTooltip', { stepType: step.stepType })}</p>
              }
            >
              <div
                className={cn(
                  'p-2 rounded-lg border',
                  getStepTypeColor(step.stepType),
                )}
              >
                {getStepIcon(
                  step.stepType,
                  'type' in step.config ? String(step.config.type) : undefined,
                )}
              </div>
            </Tooltip>
            <div className="flex-1">
              <Heading level={2} size="sm">
                {step.name}
              </Heading>
            </div>
          </>
        ) : null}
        <HStack gap={1} className="shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label={t('sidePanel.close')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
      </PanelHeader>

      {showTestPanel && automationId && organizationId ? (
        <AutomationTester
          organizationId={organizationId}
          automationId={automationId}
        />
      ) : step ? (
        <StepEditorContent
          step={step}
          editState={editState}
          onConfigChange={handleConfigChange}
          onNextStepsChange={handleNextStepsChange}
          onSave={handleSave}
          isSaving={isSaving}
          isValid={isValid}
          isDirty={isDirty}
          errors={errors}
          warnings={warnings}
          stepOptions={stepOptions}
        />
      ) : null}
    </aside>
  );
}
