'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';

import { useConfigDirtyState } from '@/app/components/ui/editor/use-config-dirty-state';
import type {
  WorkflowJsonConfig,
  WorkflowStep,
} from '@/lib/shared/schemas/workflows';

interface WorkflowConfigContextValue {
  workflowSlug: string;
  config: WorkflowJsonConfig;
  initialConfig: WorkflowJsonConfig;
  isDirty: boolean;
  isSaving: boolean;
  updateConfig: (partial: Partial<WorkflowJsonConfig>) => void;
  updateStep: (stepSlug: string, updates: Partial<WorkflowStep>) => void;
  addStep: (step: WorkflowStep) => void;
  deleteStep: (stepSlug: string) => void;
  resetConfig: () => void;
  markSaving: (saving: boolean) => void;
}

const WorkflowConfigContext = createContext<WorkflowConfigContextValue | null>(
  null,
);

export function useWorkflowConfig() {
  const ctx = useContext(WorkflowConfigContext);
  if (!ctx) {
    throw new Error(
      'useWorkflowConfig must be used within WorkflowConfigProvider',
    );
  }
  return ctx;
}

interface WorkflowConfigProviderProps {
  workflowSlug: string;
  initialConfig: WorkflowJsonConfig;
  children: React.ReactNode;
}

export function WorkflowConfigProvider({
  workflowSlug,
  initialConfig,
  children,
}: WorkflowConfigProviderProps) {
  const {
    config,
    savedConfig,
    isDirty,
    isSaving,
    configRef,
    setConfig,
    updateConfig,
    resetConfig,
    markSaved,
    setIsSaving,
  } = useConfigDirtyState<WorkflowJsonConfig>({ initial: initialConfig });

  const updateStep = useCallback(
    (stepSlug: string, updates: Partial<WorkflowStep>) => {
      setConfig((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.stepSlug === stepSlug ? { ...s, ...updates } : s,
        ),
      }));
    },
    [setConfig],
  );

  const addStep = useCallback(
    (step: WorkflowStep) => {
      setConfig((prev) => ({
        ...prev,
        steps: [...prev.steps, step],
      }));
    },
    [setConfig],
  );

  const deleteStep = useCallback(
    (stepSlug: string) => {
      setConfig((prev) => ({
        ...prev,
        steps: prev.steps
          .filter((s) => s.stepSlug !== stepSlug)
          // oxlint-disable-next-line oxc/no-map-spread -- immutable update required
          .map((s) => {
            const nextSteps = s.nextSteps;
            const hasRef = Object.values(nextSteps).some((v) => v === stepSlug);
            if (!hasRef) return s;

            const cleaned: Record<string, string> = {};
            for (const [key, value] of Object.entries(nextSteps)) {
              cleaned[key] = value === stepSlug ? '' : value;
            }
            return { ...s, nextSteps: cleaned };
          }),
      }));
    },
    [setConfig],
  );

  const markSaving = useCallback(
    (saving: boolean) => {
      setIsSaving(saving);
      // Legacy semantics: leaving the in-flight state commits the working copy
      // as the new baseline.
      if (!saving) markSaved(configRef.current);
    },
    [configRef, markSaved, setIsSaving],
  );

  const value = useMemo<WorkflowConfigContextValue>(
    () => ({
      workflowSlug,
      config,
      initialConfig: savedConfig,
      isDirty,
      isSaving,
      updateConfig,
      updateStep,
      addStep,
      deleteStep,
      resetConfig,
      markSaving,
    }),
    [
      workflowSlug,
      config,
      savedConfig,
      isDirty,
      isSaving,
      updateConfig,
      updateStep,
      addStep,
      deleteStep,
      resetConfig,
      markSaving,
    ],
  );

  return (
    <WorkflowConfigContext.Provider value={value}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}
