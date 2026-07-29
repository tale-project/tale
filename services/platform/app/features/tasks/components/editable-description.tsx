'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';

/**
 * A task's description, inline-editable, with an explicit Save / Discard pair
 * that appears while the draft is dirty (⌘/Ctrl+Enter saves, Escape discards).
 * New @mentions in the draft preview their agent-trigger effect
 * (`MentionTriggerChips`).
 *
 * With nothing written it is only its own trigger. A six-row textarea for a
 * field the reader may have nothing to say about used to own the top of every
 * task modal — worst of all on an automation-owned task, where the job is
 * uploading files and pressing Start, and the description is an optional note.
 * The label doubles as the textarea's programmatic label once open, so the
 * control is NAMED rather than merely preceded by a heading.
 */
export function EditableDescription({
  taskId,
  organizationId,
  projectId,
  value,
  label,
  placeholder,
  onSave,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
  value: string;
  /** Visible label, and the textarea's accessible name once open. */
  label: string;
  /** Placeholder while open — and the collapsed trigger's own label. */
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(value);
  const [opened, setOpened] = useState(false);
  useEffect(() => setDraft(value), [value]);

  // Explicit commit instead of save-on-blur: a blur-save would fire on any
  // click-away (incl. reaching for Discard) and silently persist half-edited
  // text. The buttons appear only while the draft differs from the saved
  // value and vanish once the server echoes the update back into `value`.
  const isDirty = draft.trim() !== value.trim();
  const save = () => {
    if (isDirty) onSave(draft.trim());
  };
  const discard = () => setDraft(value);

  // Derived, not an effect: anything written (saved or still in the draft)
  // keeps the editor open, and `opened` only latches the empty-and-untouched
  // case the reader asked to leave.
  if (!opened && value === '' && draft === '') {
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        className="-ml-3 self-start"
        onClick={() => setOpened(true)}
      >
        {placeholder}
      </Button>
    );
  }

  return (
    <>
      <MentionTextarea
        id="detail-description"
        organizationId={organizationId}
        projectId={projectId}
        label={label}
        rows={6}
        value={draft}
        placeholder={placeholder}
        // Focus only when the reader just asked for the field; an existing
        // description must not steal focus as the modal opens.
        autoFocus={opened}
        onValueChange={setDraft}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter saves, Escape discards (the mention picker consumes
          // both first while it is open).
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape' && isDirty) {
            e.preventDefault();
            discard();
          }
        }}
        placement="below"
      />
      <MentionTriggerChips
        organizationId={organizationId}
        target={{ taskId }}
        draft={draft}
        baseline={value}
      />
      {isDirty && (
        <Row gap={2} align="stretch">
          <Button onClick={save}>{tCommon('actions.save')}</Button>
          <Button variant="secondary" onClick={discard}>
            {tCommon('actions.discard')}
          </Button>
        </Row>
      )}
    </>
  );
}
