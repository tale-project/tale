'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  const [config, setConfig] = useState<WorkflowJsonConfig>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const initialRef = useRef(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;

  // Fix stale-ref bug: sync internal state when initialConfig prop changes
  // (e.g. after a refetch from the server)
  useEffect(() => {
    const serialized = JSON.stringify(initialConfig);
    if (serialized !== JSON.stringify(initialRef.current)) {
      initialRef.current = initialConfig;
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  const isDirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialRef.current),
    [config],
  );

  const updateConfig = useCallback((partial: Partial<WorkflowJsonConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateStep = useCallback(
    (stepSlug: string, updates: Partial<WorkflowStep>) => {
      setConfig((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.stepSlug === stepSlug ? { ...s, ...updates } : s,
        ),
      }));
    },
    [],
  );

  const addStep = useCallback((step: WorkflowStep) => {
    setConfig((prev) => ({
      ...prev,
      steps: [...prev.steps, step],
    }));
  }, []);

  const deleteStep = useCallback((stepSlug: string) => {
    setConfig((prev) => ({
      ...prev,
      steps: prev.steps
        .filter((s) => s.stepSlug !== stepSlug)
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
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(initialRef.current);
  }, []);

  const markSaving = useCallback((saving: boolean) => {
    setIsSaving(saving);
    if (!saving) {
      initialRef.current = configRef.current;
    }
  }, []);

  const value = useMemo<WorkflowConfigContextValue>(
    () => ({
      workflowSlug,
      config,
      initialConfig: initialRef.current,
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
