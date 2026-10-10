'use client';

import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Field } from '@tale/ui/field';
import { Textarea } from '@tale/ui/textarea';
import { ListPlus } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '@/lib/i18n/client';

import {
  fillMissingFields,
  type FilledInput,
  type MissingInputField,
} from '../lib/fixed-input';
import { fixedInputIssue, reservedInputKeys } from '../lib/trigger-draft';
import { triggerIssueText } from '../lib/trigger-issue-text';

export interface TriggerFixedInputHandle {
  /** Add the missing fields' placeholders, open the field and put the
   * caret in the first one. */
  fillMissing: () => void;
}

/**
 * The values a trigger adds to every run's input, as JSON: folded away
 * until it has a value or the deployed inputs require a field the trigger
 * does not send. **Add the missing fields** writes a typed placeholder for
 * each such field and puts the caret in the first. It is plain data: a
 * template in it is never evaluated.
 */
export const TriggerFixedInput = forwardRef<
  TriggerFixedInputHandle,
  {
    value: string;
    onChange: (value: string) => void;
    canEdit: boolean;
    /** The required fields the run input lacks that a fixed input can add. */
    missing: readonly MissingInputField[];
  }
>(function TriggerFixedInput({ value, onChange, canEdit, missing }, ref) {
  const { t } = useT('automations');
  const { t: tRecurrence } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Open while it has a value or something is missing — until the reader
  // folds or unfolds it themselves. The check against the deployed inputs
  // answers after the first paint, so this is not decided at mount.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const blank = value.trim() === '';
  const open = toggled ?? (!blank || missing.length > 0);
  // Where the caret goes once the filled text has rendered.
  const [pendingCaret, setPendingCaret] = useState<
    FilledInput['selection'] | null
  >(null);

  const issue = fixedInputIssue(value);
  const error =
    issue === null
      ? undefined
      : triggerIssueText(
          issue,
          { t, tRecurrence, locale },
          { keys: reservedInputKeys(value) },
        );
  const filled = canEdit ? fillMissingFields(value, missing) : null;

  const fill = () => {
    if (filled === null) return;
    onChange(filled.text);
    setToggled(true);
    setPendingCaret(filled.selection);
  };
  useImperativeHandle(ref, () => ({ fillMissing: fill }));

  useEffect(() => {
    if (pendingCaret === null) return;
    const field = textareaRef.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(pendingCaret.start, pendingCaret.end);
    setPendingCaret(null);
  }, [pendingCaret]);

  // A reader who cannot edit has nothing to add to an empty one.
  if (!canEdit && blank) return null;

  return (
    <CollapsibleDetails
      summary={
        blank ? t('trigger.fixedInput.add') : t('trigger.fixedInput.label')
      }
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        // React writing `open` raises the event too; only a change is news.
        if (next !== open) setToggled(next);
      }}
    >
      <div className="mt-3 flex flex-col gap-2">
        <Field
          label={t('trigger.fixedInput.label')}
          htmlFor={inputId}
          description={t('trigger.fixedInput.description')}
          error={error}
        >
          <Textarea
            ref={textareaRef}
            id={inputId}
            rows={6}
            className="font-mono text-xs"
            value={value}
            readOnly={!canEdit}
            spellCheck={false}
            placeholder='{ "owner": "acme" }'
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
        {filled !== null && (
          <div>
            <Button
              size="sm"
              variant="secondary"
              icon={ListPlus}
              onClick={fill}
            >
              {t('trigger.fixedInput.fillMissing', { count: missing.length })}
            </Button>
          </div>
        )}
      </div>
    </CollapsibleDetails>
  );
});
