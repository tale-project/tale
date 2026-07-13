'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { HStack, Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { TestTubeDiagonal, X, Save } from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';

import { PanelHeader } from '@/app/components/layout/panel-header';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useResizable } from '@/app/hooks/use-resizable';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { structuralEqual } from '@/lib/utils/structural-equal';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

import {
  getStepIcon,
  getStepTypeColor,
  type StepDef,
  type StepType,
} from '../utils/step-icons';
import { NextStepsEditor } from './next-steps-editor';
import { ValidationMessages } from './validation-messages';
import { WorkflowEnvEditor } from './workflow-env-editor';
import { WorkflowTester } from './workflow-tester';

interface WorkflowSidePanelProps {
  step: StepDef | null;
  isOpen: boolean;
  onClose: () => void;
  showTestPanel?: boolean;
  workflowId?: string;
  organizationId?: string;
  stepOptions?: Array<{
    stepSlug: string;
    name: string;
    stepType?: StepType;
    actionType?: string;
  }>;
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
}

interface EditState {
  config: string;
  nextSteps: Record<string, string>;
}

interface StepEditorContentProps {
  step: StepDef;
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
    stepType?: StepType;
    actionType?: string;
  }>;
  organizationId?: string;
  workflowSlug?: string;
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
  organizationId,
  workflowSlug,
}: StepEditorContentProps) {
  const { t } = useT('workflows');
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

        {/* Step-level env & secrets — only sandbox steps consume env. Injected
            into THIS step's sandbox, overriding workflow-level on a key clash.
            Writes straight to the workflowEnv side-table, independent of the
            step-config save below. */}
        {step.stepType === 'sandbox' && organizationId && workflowSlug && (
          <VStack gap={2}>
            <Text variant="label">{t('sidePanel.env')}</Text>
            <Text variant="caption">{t('sidePanel.envHelp')}</Text>
            <WorkflowEnvEditor
              organizationId={organizationId}
              workflowSlug={workflowSlug}
              stepSlug={step.stepSlug}
            />
          </VStack>
        )}
      </VStack>

      <HStack className="bg-background shrink-0 border-t p-3">
        <Button
          onClick={onSave}
          disabled={isSaving || !isValid || !isDirty}
          className="flex-1"
        >
          <Save className="mr-1 size-4" />
          {isSaving ? t('sidePanel.saving') : tCommon('actions.save')}
        </Button>
      </HStack>
    </>
  );
});

const EMPTY_STEP_OPTIONS: NonNullable<WorkflowSidePanelProps['stepOptions']> =
  [];

export function WorkflowSidePanel({
  step,
  isOpen,
  onClose,
  showTestPanel = false,
  workflowId,
  organizationId,
  stepOptions = EMPTY_STEP_OPTIONS,
  panelWidth,
  onPanelWidthChange,
}: WorkflowSidePanelProps) {
  const { t } = useT('workflows');
  const panelRef = useRef<HTMLDivElement>(null);
  const { width, minWidth, maxWidth, handleMouseDown, handleKeyDown } =
    useResizable(panelRef, {
      width: panelWidth,
      onWidthChange: onPanelWidthChange,
    });

  const initialEditState: EditState = { config: '', nextSteps: {} };
  const [editState, setEditState] = useState(initialEditState);
  // TODO: Replace with file-based workflow save
  const isSaving = false;

  const originalConfigJson = useMemo(
    () => (step?.config ? JSON.stringify(step.config, null, 2) : ''),
    [step?.config],
  );

  // `config` is a free-form JSON textarea, so it's compared as raw text
  // (whitespace counts). `nextSteps` is a structured object, compared
  // structurally so key-order shuffles from the server don't read as dirty.
  const isConfigDirty = editState.config !== originalConfigJson;

  const isNextStepsDirty = !structuralEqual(
    editState.nextSteps,
    step?.nextSteps ?? {},
  );

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

  // TODO: Replace with file-based step validation
  const isValid = parsedEditedConfig !== null;
  const errors: string[] = [];
  const warnings: string[] = [];

  const handleConfigChange = useCallback((value: string) => {
    setEditState((prev) => ({ ...prev, config: value }));
  }, []);

  const handleNextStepsChange = useCallback((value: Record<string, string>) => {
    setEditState((prev) => ({ ...prev, nextSteps: value }));
  }, []);

  // TODO: Replace with file-based workflow save (modify workflow JSON and save via useSaveWorkflow)
  const handleSave = useCallback(() => {
    if (!step || !parsedEditedConfig || !isValid || !isDirty) return;

    toast({
      title: t('sidePanel.stepSaveFailed'),
      description: t('sidePanel.fileBasedStepSaveUnsupported'),
      variant: 'destructive',
    });
  }, [step, parsedEditedConfig, isValid, isDirty, t]);

  if (!isOpen) return null;

  return (
    <Stack
      ref={panelRef}
      role="complementary"
      aria-label={
        showTestPanel
          ? t('sidePanel.testWorkflow')
          : (step?.name ?? t('sidePanel.stepEditor'))
      }
      style={{ '--panel-width': `${width}px` }}
      as="aside"
      gap={0}
      className="bg-background border-border relative min-h-0 w-(--panel-width) flex-[0_0_auto] overflow-hidden border-l max-md:absolute max-md:inset-0 max-md:z-10 max-md:w-full"
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
            <div className="border-success/30 bg-success/10 text-success rounded-lg border p-2">
              <TestTubeDiagonal className="size-4" />
            </div>
            <div className="flex-1">
              <Heading level={2} size="sm">
                {t('sidePanel.testWorkflow')}
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
                  'type' in step.config ? step.config.type : undefined,
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
            title={t('sidePanel.close')}
            aria-label={t('sidePanel.close')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
      </PanelHeader>

      {showTestPanel && workflowId && organizationId ? (
        <WorkflowTester
          organizationId={organizationId}
          workflowSlug={workflowId}
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
          organizationId={organizationId}
          workflowSlug={workflowId ? urlParamToSlug(workflowId) : undefined}
        />
      ) : null}
    </Stack>
  );
}
