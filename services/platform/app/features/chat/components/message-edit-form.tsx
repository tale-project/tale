'use client';

/**
 * The in-place editor a user message swaps into: the original text, ready to
 * change, with Send starting the edited version as a new sibling branch.
 * Enter sends, Shift+Enter breaks the line, Escape cancels.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

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

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed === initialText.trim()) {
      onCancel();
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <Stack gap={2} className="w-full max-w-md">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={t('editMessage')}
        autoFocus
        rows={3}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === 'Escape') onCancel();
        }}
        className="border-border bg-background focus-visible:ring-ring min-h-[72px] w-full resize-none rounded-xl border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
      />
      <Row gap={2} className="justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7">
          {tCommon('actions.cancel')}
        </Button>
        <Button size="sm" onClick={submit} className="h-7">
          {t('editSend')}
        </Button>
      </Row>
    </Stack>
  );
}
