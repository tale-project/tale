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
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

export function MessageEditForm({
  initialText,
  onSubmit,
  onCancel,
}: {
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const [text, setText] = useState(initialText);
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
  const canSend = trimmed.length > 0 && trimmed !== initialText.trim();

  const submit = () => {
    if (!canSend) return;
    onSubmit(trimmed);
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
