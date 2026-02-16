'use client';

import { CheckCircle, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

interface TestResultFeedbackProps {
  result: { success: boolean; message: string };
  onDismiss: () => void;
  closeLabel: string;
}

export function TestResultFeedback({
  result,
  onDismiss,
  closeLabel,
}: TestResultFeedbackProps) {
  return (
    <output
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 text-sm',
        result.success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'border-destructive/30 bg-destructive/5 text-destructive',
      )}
      aria-live="polite"
    >
      {result.success ? (
        <CheckCircle className="size-4 shrink-0" />
      ) : (
        <XCircle className="size-4 shrink-0" />
      )}
      <span className="flex-1">{result.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="hover:bg-foreground/5 shrink-0 rounded p-0.5"
        aria-label={closeLabel}
      >
        <X className="size-3.5" />
      </button>
    </output>
  );
}
