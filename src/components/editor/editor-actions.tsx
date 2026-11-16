'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { toast } from '@tale/ui/use-toast';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { hasDisabledReason } from '../overlays/disabled-reason';
import { toastSaveFailure } from './save-failure-toast';
import {
  isEditorSaveCancelled,
  type EditorController,
  type EditorTelemetryEvent,
} from './types';

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
   *
   * Legacy escape hatch: a new controller follows the save-feedback contract on
   * `EditorController.save` instead — throw a translated message and let this
   * cluster own the single toast.
   */
  suppressServerErrorToast?: boolean;
  /**
   * Show the controller's `invalidReason` as a visible line before the
   * buttons instead of a hover/focus tooltip on Save — for sheets and phone
   * layouts, where no pointer hovers and a tooltip is never seen.
   */
  inlineReason?: boolean;
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
  inlineReason = false,
  className,
}: EditorActionsProps) {
  const { t } = useT('common');
  const reasonId = useId();
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
      // A save that asked the user something and got "no" is not a failure:
      // stay silent, leave the edits dirty, and keep it out of the
      // failure-rate signal.
      if (isEditorSaveCancelled(err)) {
        onEvent?.({ type: 'save_cancelled', entityKind, durationMs });
        return;
      }
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
        toastSaveFailure(err, t);
      }
    }
  }, [controller, entityKind, onEvent, suppressServerErrorToast, t]);

  const handleDiscard = useCallback(() => {
    if (!controller.isDirty || controller.isSaving) return;
    controller.reset();
    onEvent?.({ type: 'discard', entityKind });
  }, [controller, entityKind, onEvent]);

  const saveRef = useRef<HTMLButtonElement>(null);

  // ⌘S / Ctrl+S — only while the cluster is mounted AND dirty. Suppresses
  // the browser's native page-save dialog only in that narrow window, even
  // when the edits cannot be saved: the page's HTML is never what the
  // author meant to save.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!canEdit) return;
      const isSaveCombo =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
      if (!isSaveCombo) return;
      if (!controller.isDirty || controller.isSaving) return;
      e.preventDefault();
      if (!controller.isValid) {
        // Say why nothing saved: focus on Save opens its reason (an inline
        // reason already stands beside it).
        if (!inlineReason) saveRef.current?.focus();
        return;
      }
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
    inlineReason,
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
  // The reason speaks only when invalid edits are what holds Save back —
  // not while there is nothing to save, or a save or load is under way.
  const invalidReason =
    controller.isDirty &&
    !controller.isSaving &&
    !controller.isLoading &&
    !controller.isValid &&
    hasDisabledReason(controller.invalidReason)
      ? controller.invalidReason
      : undefined;
  const showInlineReason = inlineReason && invalidReason !== undefined;

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      aria-live="polite"
    >
      {history}
      {showInlineReason && (
        // Inside the cluster's live region, but not part of it: the
        // reason changes as the reader types, and the check's result is
        // announced once elsewhere.
        <p
          id={reasonId}
          aria-live="off"
          className="text-muted-foreground min-w-0 text-xs"
        >
          {invalidReason}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        onClick={handleDiscard}
        variant="secondary"
        // The `sm` size is 32px tall — below the 44px WCAG 2.5.5 touch
        // target. Keep the visual box at 32px and extend the tappable area
        // to ≥44px via an invisible pseudo-element overlay on mobile only
        // (WCAG 2.5.5 / #1980).
        className="relative max-sm:after:absolute max-sm:after:-inset-1.5 max-sm:after:content-['']"
        disabled={discardDisabled}
        aria-disabled={discardDisabled ? 'true' : undefined}
      >
        {t('actions.discard')}
      </Button>
      <Button
        ref={saveRef}
        type={formId ? 'submit' : 'button'}
        size="sm"
        form={formId}
        className="relative max-sm:after:absolute max-sm:after:-inset-1.5 max-sm:after:content-['']"
        onClick={formId ? undefined : () => void runSave()}
        disabled={saveDisabled}
        disabledReason={showInlineReason ? undefined : invalidReason}
        aria-describedby={showInlineReason ? reasonId : undefined}
        isLoading={controller.isSaving}
        aria-busy={controller.isSaving ? 'true' : undefined}
      >
        {flashSaved ? t('actions.saved') : t('actions.save')}
      </Button>
    </div>
  );
}
