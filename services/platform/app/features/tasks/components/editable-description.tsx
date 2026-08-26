'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';

/**
 * A task's description: rendered prose by default, an inline editor on demand,
 * with an explicit Save / Discard pair while the draft is dirty (⌘/Ctrl+Enter
 * saves, Escape leaves). New @mentions in the draft preview their agent-trigger
 * effect (`MentionTriggerChips`).
 *
 * Reading comes first because a textarea holds raw text: while the editor was
 * permanently open, every link someone wrote in a description was unclickable
 * plain text for anyone allowed to edit the task — only read-only viewers ever
 * saw the markdown. The read view is the same renderer the comment thread uses
 * ({@link MentionText}), so links, lists and mention pills all render, and the
 * editor is one click (or the Edit button) away.
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
  /** Rejects when the write failed, so the draft can be kept on screen. */
  onSave: (value: string) => void | Promise<unknown>;
}) {
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);

  // Explicit commit instead of save-on-blur: a blur-save would fire on any
  // click-away (incl. reaching for Discard) and silently persist half-edited
  // text. The buttons appear only while the draft differs from the saved value.
  const isDirty = draft.trim() !== value.trim();
  const save = async () => {
    if (!isDirty) {
      setEditing(false);
      return;
    }
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (error) {
      // The caller reports the failure; the editor stays open so the typed
      // draft survives it rather than collapsing back to the stale prose.
      console.warn('[tasks] description save failed', error);
    } finally {
      setIsSaving(false);
    }
  };
  const discard = () => {
    setDraft(value);
    setEditing(false);
  };

  // A click on a link is navigation, and a click that ends a text selection is
  // a copy — neither is a request to edit. Everything else in the prose is.
  const editFromProse = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('a, button, summary, [role="button"]')
    ) {
      return;
    }
    if ((document.getSelection()?.toString().length ?? 0) > 0) return;
    setEditing(true);
  };

  if (!editing) {
    // Empty and editable collapses to its own trigger — see the note above.
    if (value === '') {
      return (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className="-ml-3 self-start"
          onClick={() => setEditing(true)}
        >
          {placeholder}
        </Button>
      );
    }

    return (
      <div className="group/description flex flex-col gap-1.5">
        <Row justify="between" gap={2}>
          <Text as="h3" variant="label">
            {label}
          </Text>
          {/* Revealed on hover/focus like the comment actions: it is the
              keyboard path to the editor, so it stays in the tab order and
              appears the moment it takes focus. */}
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            className="-my-1 opacity-0 transition-opacity group-focus-within/description:opacity-100 group-hover/description:opacity-100"
            onClick={() => setEditing(true)}
          >
            {tCommon('actions.edit')}
          </Button>
        </Row>
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- click-to-edit shortcut over prose that CONTAINS its own links; the Edit button above is the keyboard path */}
        <div
          className="hover:bg-muted/40 -mx-2 cursor-text rounded-md px-2 py-1 transition-colors"
          onClick={editFromProse}
        >
          <MentionText
            body={value}
            organizationId={organizationId}
            projectId={projectId}
            className="wrap-break-word"
          />
        </div>
      </div>
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
        autoFocus
        onValueChange={setDraft}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter saves, Escape leaves the editor (the mention picker
          // consumes both first while it is open).
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!isSaving) void save();
          } else if (e.key === 'Escape') {
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
      <Row gap={2} align="stretch">
        <Button
          disabled={!isDirty || isSaving}
          isLoading={isSaving}
          onClick={() => void save()}
        >
          {tCommon('actions.save')}
        </Button>
        <Button variant="secondary" onClick={discard} disabled={isSaving}>
          {isDirty ? tCommon('actions.discard') : tCommon('actions.cancel')}
        </Button>
      </Row>
    </>
  );
}
