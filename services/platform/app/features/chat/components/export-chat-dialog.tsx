'use client';

/**
 * Export the conversation: pick messages, then download Markdown or print
 * (the browser's print-to-PDF). Reads the already-warm message subscription —
 * no export backend, the transcript IS the data.
 */

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useId, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

import { useChatMessages } from '../data/chat-backend';
import { messagePlainText } from '../lib/message-text';
import type { ChatMessageView } from '../types';

interface ExportChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  threadId: string;
  threadTitle?: string;
}

/** The exportable rows: the conversation's spoken turns, not tool plumbing. */
function exportableRows(
  messages: readonly ChatMessageView[],
): ChatMessageView[] {
  return messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      messagePlainText(message.parts).length > 0,
  );
}

export function ExportChatDialog({
  open,
  onOpenChange,
  organizationId,
  threadId,
  threadTitle,
}: ExportChatDialogProps) {
  const { t } = useT('chat');
  const idPrefix = useId();
  const messages = useChatMessages(organizationId, open ? threadId : undefined);
  // Deselected ids — "everything selected" is the default and survives new
  // rows arriving while the dialog is open.
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(
    () => (messages.status === 'ready' ? exportableRows(messages.data) : []),
    [messages],
  );
  const selectedRows = rows.filter((row) => !deselected.has(row.id));
  const allSelected = selectedRows.length === rows.length;

  const toggle = (id: string) => {
    setDeselected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const roleLabel = (role: ChatMessageView['role']): string =>
    role === 'user' ? t('export.you') : t('export.assistant');

  const buildMarkdown = (): string =>
    selectedRows
      .map(
        (row) =>
          `**${roleLabel(row.role)}:**\n\n${messagePlainText(row.parts)}`,
      )
      .join('\n\n---\n\n');

  const handleDownload = () => {
    const blob = new Blob([buildMarkdown()], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(threadTitle ?? 'chat').replaceAll('/', '-')}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.append(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return;
    }
    const escapeHtml = (text: string) =>
      text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${escapeHtml(threadTitle ?? 'chat')}</title>` +
        '<style>body{font:14px/1.5 system-ui;max-width:48rem;margin:2rem auto;padding:0 1rem}h4{margin:1.5rem 0 .25rem}p{white-space:pre-wrap;margin:0}</style>' +
        '</head><body>' +
        selectedRows
          .map(
            (row) =>
              `<h4>${escapeHtml(roleLabel(row.role))}</h4><p>${escapeHtml(messagePlainText(row.parts))}</p>`,
          )
          .join('') +
        '</body></html>',
    );
    doc.close();
    frame.contentWindow?.print();
    // Give the print dialog time to snapshot the frame before removal.
    setTimeout(() => frame.remove(), 1000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('export.title')}
      description={t('export.description')}
      size="lg"
      footer={
        <Row gap={2} className="justify-end">
          <Button
            variant="secondary"
            onClick={handlePrint}
            disabled={selectedRows.length === 0}
          >
            {t('export.downloadPdf')}
          </Button>
          <Button onClick={handleDownload} disabled={selectedRows.length === 0}>
            {t('export.downloadMarkdown')}
          </Button>
        </Row>
      }
    >
      {rows.length === 0 ? (
        <Text variant="muted" className="text-sm">
          {t('export.noMessages')}
        </Text>
      ) : (
        <Stack gap={3} className="min-h-0">
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            <label
              htmlFor={`${idPrefix}-all`}
              className="hover:bg-muted/30 flex w-full cursor-pointer items-center gap-3 p-3 transition-colors"
            >
              <Checkbox
                id={`${idPrefix}-all`}
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setDeselected(
                    checked === true
                      ? new Set()
                      : new Set(rows.map((row) => row.id)),
                  )
                }
              />
              <Text className="flex-1 text-sm font-medium">
                {allSelected ? t('export.deselectAll') : t('export.selectAll')}
              </Text>
              <Text variant="muted" className="text-xs">
                {t('export.messagesCount', {
                  count: selectedRows.length,
                  total: rows.length,
                })}
              </Text>
            </label>
            <div className="max-h-64 overflow-y-auto">
              <ul className="divide-border divide-y">
                {rows.map((row) => (
                  <li key={row.id}>
                    <label
                      htmlFor={`${idPrefix}-${row.id}`}
                      className="hover:bg-muted/30 flex w-full cursor-pointer items-start gap-3 p-3 transition-colors"
                    >
                      <Checkbox
                        id={`${idPrefix}-${row.id}`}
                        checked={!deselected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                        className="mt-0.5"
                      />
                      <Stack gap={1} className="min-w-0 flex-1">
                        <Text className="text-sm font-medium">
                          {roleLabel(row.role)}
                        </Text>
                        <Text variant="caption" className="truncate">
                          {messagePlainText(row.parts)}
                        </Text>
                      </Stack>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Stack>
      )}
    </Dialog>
  );
}
