'use client';

import { Button } from '@tale/ui/button';
import { Check, Loader2, Save, Undo2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { EditorController, EditorTelemetryEvent } from './types';

interface EditorActionsProps {
  controller: EditorController;
  /** Optional pre-cluster slot (typically a `VersionHistoryButton`). */
  history?: ReactNode;
  /**
   * Permission gate. When `false` the cluster is hidden — read-only
   * viewers should never see a disabled Save button (it looks broken).
   * Default: `true` (visible).
   */
  canEdit?: boolean;
  /**
   * When set, Save renders as `<button type="submit" form={formId}>` and
   * native submit semantics drive the action. Use for RHF-backed pages
   * that wrap fields in `<form id={x} onSubmit={editor.form.handleSubmit(...)}>`.
   */
  formId?: string;
  /** Telemetry sink. No-op when omitted. */
  onEvent?: (event: EditorTelemetryEvent) => void;
  /** Tag for telemetry (e.g. `'agent'`, `'org_settings'`). */
  entityKind?: string;
  /**
   * Opt out of the generic server-error toast when the controller's own
   * `save()` already surfaces a (typically localized) failure message itself —
   * otherwise the user sees two destructive toasts for one failure. Validation
   * failures are still toasted here, since callers don't handle those. Default
   * `false` (EditorActions owns all error toasting).
   */
  suppressServerErrorToast?: boolean;
  className?: string;
}

const SAVED_FLASH_MS = 1500;

export function EditorActions({
  controller,
  history,
  canEdit = true,
  formId,
  onEvent,
  entityKind = 'unknown',
  suppressServerErrorToast = false,
  className,
}: EditorActionsProps) {
  const { t } = useT('common');
  const [flashSaved, setFlashSaved] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const runSave = useCallback(async () => {
    if (controller.isSaving || !controller.isDirty || !controller.isValid)
      return;
    const start = performance.now();
    onEvent?.({ type: 'save_attempt', entityKind });
    try {
      await controller.save();
      const durationMs = performance.now() - start;
      onEvent?.({ type: 'save_success', entityKind, durationMs });
      setFlashSaved(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(
        () => setFlashSaved(false),
        SAVED_FLASH_MS,
      );
    } catch (err) {
      const durationMs = performance.now() - start;
      const reason =
        err instanceof Error && err.message === 'VALIDATION_FAILED'
          ? 'validation'
          : 'server';
      onEvent?.({ type: 'save_failure', entityKind, durationMs, reason });
      if (reason === 'validation') {
        toast({
          title: t('actions.save'),
          description: t('editor.fixHighlightedFields'),
          variant: 'destructive',
        });
      } else if (!suppressServerErrorToast) {
        toast({
          title: t('actions.save'),
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    }
  }, [controller, entityKind, onEvent, suppressServerErrorToast, t]);

  const handleDiscard = useCallback(() => {
    if (!controller.isDirty || controller.isSaving) return;
    controller.reset();
    onEvent?.({ type: 'discard', entityKind });
  }, [controller, entityKind, onEvent]);

  // ⌘S / Ctrl+S — only while the cluster is mounted AND dirty. Suppresses
  // the browser's native page-save dialog only in that narrow window.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!canEdit) return;
      const isSaveCombo =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
      if (!isSaveCombo) return;
      if (!controller.isDirty || controller.isSaving || !controller.isValid)
        return;
      e.preventDefault();
      void runSave();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [
    canEdit,
    controller.isDirty,
    controller.isSaving,
    controller.isValid,
    runSave,
  ]);

  if (!canEdit) return null;

  const saveDisabled =
    !controller.isDirty ||
    controller.isSaving ||
    !controller.isValid ||
    controller.isLoading;
  const discardDisabled =
    !controller.isDirty || controller.isSaving || controller.isLoading;

  return (
    <div
      className={cn(
        'ml-auto sticky right-0 z-10 flex items-center gap-2 bg-background/95 pl-3',
        'before:pointer-events-none before:absolute before:-left-6 before:top-0 before:h-full before:w-6 before:bg-gradient-to-r before:from-transparent before:to-background/95',
        className,
      )}
      aria-live="polite"
    >
      {history}
      <Button
        type="button"
        size="sm"
        onClick={handleDiscard}
        variant="secondary"
        icon={Undo2}
        iconClassName="size-3.5"
        collapseLabel
        // The `sm` size is 32px tall and, once the label collapses to an icon
        // below the `sm` breakpoint, narrower than the 44px WCAG 2.5.5 touch
        // target. Grow the hit area to 44×44px on mobile only; the dense
        // desktop size is kept from `sm` up (WCAG 2.5.5 / #1980).
        className="max-sm:min-h-11 max-sm:min-w-11"
        disabled={discardDisabled}
        aria-disabled={discardDisabled ? 'true' : undefined}
      >
        {t('actions.discard')}
      </Button>
      <Button
        type={formId ? 'submit' : 'button'}
        size="sm"
        form={formId}
        className="max-sm:min-h-11 max-sm:min-w-11"
        onClick={formId ? undefined : () => void runSave()}
        disabled={saveDisabled}
        aria-busy={controller.isSaving ? 'true' : undefined}
      >
        {controller.isSaving ? (
          <Loader2
            className="size-3.5 animate-spin sm:mr-1.5"
            aria-hidden="true"
          />
        ) : flashSaved ? (
          <Check className="size-3.5 sm:mr-1.5" aria-hidden="true" />
        ) : (
          <Save className="size-3.5 sm:mr-1.5" aria-hidden="true" />
        )}
        {/* Collapse the label to an icon on mobile (still in the a11y tree)
            to match `collapseLabel`; the icon here is dynamic, so the pattern
            is applied inline rather than via the Button prop. */}
        <span className="sr-only sm:not-sr-only">
          {controller.isSaving
            ? t('actions.saving')
            : flashSaved
              ? t('actions.saved')
              : t('actions.save')}
        </span>
      </Button>
    </div>
  );
}
