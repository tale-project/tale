'use client';

/**
 * The in-place editor a user message swaps into: the original text, ready to
 * change, with Send starting the edited version as a new sibling branch.
 * Enter sends, Shift+Enter breaks the line, Escape cancels.
 *
 * The editor reads as the bubble it replaced — same rounded frame, widened
 * to the thread's edit width — and the field grows with its content instead
 * of scrolling inside a fixed box. Send stays disabled until the text is
 * non-empty AND actually different: an unchanged send would fork a sibling
 * identical to the original.
 *
 * Send hands the draft to `onSubmit` and waits for its verdict: `true` means
 * the edit started (the owner closes the form), `false` that it was refused
 * before anything was written — a reached usage cap, say — and the form
 * stays open with the draft intact, so nothing has to be retyped. Send is
 * disabled while the verdict is pending, so a second Enter cannot fork
 * twice.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { hasVisibleText } from '@/lib/shared/utils/visible-text';

export function MessageEditForm({
  initialText,
  onSubmit,
  onCancel,
}: {
  initialText: string;
  /** Resolves whether the edit was accepted; `false` keeps the form open. */
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const [text, setText] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the content: height resets so a deleted line shrinks the box
  // back instead of leaving dead space.
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Focus with the caret at the END — the browser default (caret at the
    // start, or all-selected) invites accidentally retyping the message.
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autoResize();
  }, [autoResize]);

  const trimmed = text.trim();
  const canSend =
    !submitting && hasVisibleText(trimmed) && trimmed !== initialText.trim();

  const submit = () => {
    if (!canSend) return;
    setSubmitting(true);
    onSubmit(trimmed).then(
      (accepted) => {
        // Accepted: the owner swaps the form out; nothing to reset here.
        if (!accepted) setSubmitting(false);
      },
      (error: unknown) => {
        console.error('[chat] the edit could not be started', error);
        setSubmitting(false);
      },
    );
  };

  return (
    <Stack
      gap={2}
      className="bg-muted/50 border-border w-full max-w-[85%] rounded-2xl border p-4"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          autoResize();
        }}
        aria-label={t('editMessage')}
        rows={1}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') onCancel();
        }}
        className="text-foreground min-h-[40px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm focus-visible:outline-none"
      />
      <Row gap={2} className="justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 rounded-full"
        >
          {tCommon('actions.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={!canSend}
          className="h-7 rounded-full"
        >
          {t('editSend')}
        </Button>
      </Row>
    </Stack>
  );
}
