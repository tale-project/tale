'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils/cn';

import {
  WizardContext,
  type WizardBeforeNext,
  type WizardContextValue,
  type WizardStatus,
  type WizardStepMeta,
  useWizard,
} from './use-wizard';

export interface WizardProps {
  /** Ordered step descriptors. `id` must match each `<WizardStep id>`. */
  steps: WizardStepMeta[];
  /** Controlled active index. */
  activeIndex?: number;
  /** Uncontrolled initial index (default 0). */
  defaultActiveIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Called when the user finishes the last step. May be async. */
  onFinish: () => void | Promise<void>;
  /**
   * Builds the screen-reader progress announcement. Caller-provided so the
   * string is translated; defaults to a plain "Step N of M: label".
   */
  formatProgress?: (current: number, total: number, label: string) => string;
  className?: string;
  children: ReactNode;
}

function defaultFormatProgress(
  current: number,
  total: number,
  label: string,
): string {
  return `Step ${current} of ${total}: ${label}`;
}

/**
 * Host-agnostic multi-step wizard mechanism. It owns step state, per-step
 * validity gating, and focus/aria-live announcements, but renders no dialog of
 * its own — drop `<WizardProgress>`, `<WizardStep>`s, and `<WizardFooter>` into
 * whatever shell fits (FormDialog, ResponsiveDialog, a full-screen page).
 */
export function Wizard({
  steps,
  activeIndex: controlledIndex,
  defaultActiveIndex = 0,
  onIndexChange,
  onFinish,
  formatProgress = defaultFormatProgress,
  className,
  children,
}: WizardProps) {
  const isControlled = controlledIndex !== undefined;
  const [uncontrolledIndex, setUncontrolledIndex] =
    useState(defaultActiveIndex);
  const activeIndex = isControlled ? controlledIndex : uncontrolledIndex;

  const [maxVisitedIndex, setMaxVisitedIndex] = useState(activeIndex);
  const [status, setStatus] = useState<WizardStatus>('idle');
  const [validity, setValidity] = useState<Record<string, boolean>>({});
  const beforeNextHandlers = useRef<Record<string, WizardBeforeNext>>({});

  const activeStep = steps[activeIndex];
  const isFirst = activeIndex === 0;
  const isLast = activeIndex === steps.length - 1;

  const moveTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, steps.length - 1));
      setMaxVisitedIndex((prev) => Math.max(prev, clamped));
      if (!isControlled) setUncontrolledIndex(clamped);
      onIndexChange?.(clamped);
    },
    [isControlled, onIndexChange, steps.length],
  );

  const setStepValid = useCallback((id: string, valid: boolean) => {
    setValidity((prev) =>
      prev[id] === valid ? prev : { ...prev, [id]: valid },
    );
  }, []);

  const setStepBeforeNext = useCallback(
    (id: string, handler: WizardBeforeNext | undefined) => {
      if (handler) beforeNextHandlers.current[id] = handler;
      else delete beforeNextHandlers.current[id];
    },
    [],
  );

  // Unregistered steps default to valid; only an explicit `valid={false}` gates.
  // `?? true` keeps the tri-state (undefined → valid) without a boolean compare.
  const isStepValid = useCallback(
    (id: string) => validity[id] ?? true,
    [validity],
  );

  const goNext = useCallback(() => {
    const step = steps[activeIndex];
    if (!step || !isStepValid(step.id)) return;

    const run = async () => {
      const handler = beforeNextHandlers.current[step.id];
      if (handler) {
        setStatus('submitting');
        try {
          const ok = await handler();
          if (!ok) return; // stay on the step (e.g. server rejected input)
        } catch (err) {
          // Never swallow silently — surface for debugging and stay put.
          console.error('Wizard step onBeforeNext failed:', err);
          return;
        } finally {
          setStatus('idle');
        }
      }
      if (activeIndex >= steps.length - 1) {
        await Promise.resolve(onFinish());
      } else {
        moveTo(activeIndex + 1);
      }
    };
    void run();
  }, [activeIndex, isStepValid, moveTo, onFinish, steps]);

  const goBack = useCallback(() => {
    if (activeIndex > 0) moveTo(activeIndex - 1);
  }, [activeIndex, moveTo]);

  const skip = useCallback(() => {
    const step = steps[activeIndex];
    if (!step?.optional) return;
    if (activeIndex >= steps.length - 1) void Promise.resolve(onFinish());
    else moveTo(activeIndex + 1);
  }, [activeIndex, moveTo, onFinish, steps]);

  const goTo = useCallback(
    (index: number) => {
      // Only allow jumping to already-visited steps; never skip ahead.
      if (index <= maxVisitedIndex) moveTo(index);
    },
    [maxVisitedIndex, moveTo],
  );

  const value = useMemo<WizardContextValue>(
    () => ({
      steps,
      activeIndex,
      activeStep,
      isFirst,
      isLast,
      status,
      maxVisitedIndex,
      goNext,
      goBack,
      goTo,
      skip,
      setStepValid,
      setStepBeforeNext,
      isStepValid,
    }),
    [
      steps,
      activeIndex,
      activeStep,
      isFirst,
      isLast,
      status,
      maxVisitedIndex,
      goNext,
      goBack,
      goTo,
      skip,
      setStepValid,
      setStepBeforeNext,
      isStepValid,
    ],
  );

  const progressText = activeStep
    ? formatProgress(activeIndex + 1, steps.length, activeStep.label)
    : '';

  return (
    <WizardContext.Provider value={value}>
      <div className={cn('flex flex-col gap-6', className)}>
        {/* Polite live region announces step changes to assistive tech. */}
        <div aria-live="polite" className="sr-only">
          {progressText}
        </div>
        {children}
      </div>
    </WizardContext.Provider>
  );
}

export interface WizardStepProps {
  /** Must match one of the `steps` ids passed to `<Wizard>`. */
  id: string;
  /**
   * Whether the step's inputs are valid. When `false`, Next is disabled.
   * Defaults to `true` (steps with no validation are always passable).
   */
  valid?: boolean;
  /**
   * Run on Next/Finish before advancing; return `false` to stay on the step.
   * Use for side effects (create org, save provider) gated on success.
   */
  onBeforeNext?: WizardBeforeNext;
  children: ReactNode;
}

/**
 * A single step. Renders its children only while active, registers its
 * validity + advance hook, and moves focus to itself on activation so keyboard
 * and screen-reader users land on the new content.
 */
export function WizardStep({
  id,
  valid = true,
  onBeforeNext,
  children,
}: WizardStepProps) {
  const { activeStep, setStepValid, setStepBeforeNext } = useWizard();
  const containerRef = useRef<HTMLDivElement>(null);
  const isActive = activeStep?.id === id;

  useEffect(() => {
    setStepValid(id, valid);
  }, [id, valid, setStepValid]);

  useEffect(() => {
    setStepBeforeNext(id, onBeforeNext);
    return () => setStepBeforeNext(id, undefined);
  }, [id, onBeforeNext, setStepBeforeNext]);

  useEffect(() => {
    if (isActive) containerRef.current?.focus();
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="group"
      aria-label={activeStep?.label}
      className="flex flex-col gap-4 outline-none"
    >
      {children}
    </div>
  );
}
