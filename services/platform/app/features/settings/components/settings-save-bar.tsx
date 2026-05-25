'use client';

import { Button } from '@tale/ui/button';
import { useSafeAreaInsets } from '@tale/ui/use-safe-area-insets';
import type { CSSProperties } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface SettingsSaveBarProps {
  isDirty: boolean;
  isSubmitting?: boolean;
  isValid?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
  discardLabel?: string;
  /** Form id when the bar's Save button should submit a named form. */
  formId?: string;
  className?: string;
}

/**
 * Sticky save bar shown only while the surrounding form is dirty. Owns the
 * standard save/discard pair for every settings form so the buttons sit in
 * exactly the same place on every page. Respects iOS safe-area inset.
 */
export function SettingsSaveBar({
  isDirty,
  isSubmitting = false,
  isValid = true,
  onSave,
  onDiscard,
  saveLabel,
  discardLabel,
  formId,
  className,
}: SettingsSaveBarProps) {
  const { t: tCommon } = useT('common');
  const { bottom } = useSafeAreaInsets();

  if (!isDirty) return null;

  const style: CSSProperties | undefined =
    bottom > 0 ? { paddingBottom: bottom } : undefined;

  return (
    <div
      role="region"
      aria-label={tCommon('aria.unsavedChanges')}
      aria-live="polite"
      style={style}
      className={cn(
        'border-border bg-background/95 sticky bottom-0 z-30 -mx-4 flex items-center justify-end gap-2 border-t px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-md sm:border',
        className,
      )}
    >
      {onDiscard && (
        <Button
          type="button"
          variant="ghost"
          onClick={onDiscard}
          disabled={isSubmitting}
        >
          {discardLabel ?? tCommon('actions.discard')}
        </Button>
      )}
      <Button
        type={formId ? 'submit' : 'button'}
        form={formId}
        variant="primary"
        onClick={formId ? undefined : onSave}
        disabled={isSubmitting || !isValid}
        isLoading={isSubmitting}
      >
        {saveLabel ?? tCommon('actions.saveChanges')}
      </Button>
    </div>
  );
}
