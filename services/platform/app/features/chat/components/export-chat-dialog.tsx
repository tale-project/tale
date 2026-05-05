'use client';

import { Button } from '@tale/ui/button';
import { Download, FileText } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface ExportChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  organizationId: string;
}

interface ExportMessage {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Strip internal structural markers that the UI already filters during rendering */
const INTERNAL_MARKER_REGEX =
  /\[\[(CONCLUSION|KEY_POINTS|DETAILS|QUESTIONS|NEXT_STEPS)\]\]\n?/g;

function stripMarkers(text: string) {
  return text.replace(INTERNAL_MARKER_REGEX, '');
}

function getSelectedMessages(
  messages: ExportMessage[],
  effectiveSelected: Set<string>,
) {
  return messages.filter((m) => effectiveSelected.has(m._id));
}

function formatMessagesAsMarkdown(
  messages: ExportMessage[],
  youLabel: string,
  assistantLabel: string,
) {
  const lines = [];
  for (const msg of messages) {
    const roleLabel =
      msg.role === 'user' ? `**${youLabel}:**` : `**${assistantLabel}:**`;
    lines.push(`${roleLabel}\n\n${stripMarkers(msg.content)}\n\n---\n`);
  }
  return lines.join('\n');
}

function triggerFileDownload(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printViaIframe(
  messages: ExportMessage[],
  title: string,
  youLabel: string,
  assistantLabel: string,
) {
  const messagesHtml = messages
    .map((msg) => {
      const role = msg.role === 'user' ? youLabel : assistantLabel;
      const content = escapeHtml(stripMarkers(msg.content)).replace(
        /\n/g,
        '<br/>',
      );
      return `<div class="message"><div class="role">${escapeHtml(role)}</div><div class="content">${content}</div></div>`;
    })
    .join('<hr/>');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5rem 0; }
  .role { font-weight: 600; margin-bottom: 0.5rem; }
  .content { white-space: pre-wrap; word-break: break-word; }
  .message { margin: 1rem 0; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<hr/>
${messagesHtml}
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.inset = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  const cleanup = () => {
    document.body.removeChild(iframe);
  };

  // Delay to allow iframe content to render, then print
  setTimeout(() => {
    iframe.contentWindow?.print();
    // Clean up after print dialog closes
    iframe.contentWindow?.addEventListener('afterprint', cleanup);
    // Fallback: clean up after timeout in case afterprint doesn't fire
    setTimeout(cleanup, 60_000);
  }, 300);
}

function ExportChatDialogContent({
  open,
  onOpenChange,
  threadId,
}: ExportChatDialogProps) {
  const { t } = useT('chat');

  const { data } = useConvexQuery(api.threads.queries.getThreadMessages, {
    threadId,
  });

  const messages: ExportMessage[] = useMemo(
    () =>
      (data?.messages ?? [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ _id: m._id, role: m.role, content: m.content })),
    [data?.messages],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Sync selection with messages once loaded (default all selected)
  const allIds = useMemo(() => new Set(messages.map((m) => m._id)), [messages]);
  const effectiveSelected = useMemo(() => {
    if (selectedIds.size === 0 && messages.length > 0) {
      return allIds;
    }
    // Remove stale IDs that no longer exist
    const valid = new Set<string>();
    for (const id of selectedIds) {
      if (allIds.has(id)) valid.add(id);
    }
    return valid;
  }, [selectedIds, allIds, messages.length]);

  const allSelected = effectiveSelected.size === messages.length;
  const noneSelected = effectiveSelected.size === 0;

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m._id)));
    }
  }, [allSelected, messages]);

  const handleToggleMessage = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const base =
          prev.size === 0 && messages.length > 0
            ? new Set(messages.map((m) => m._id))
            : new Set(prev);
        if (base.has(id)) {
          base.delete(id);
        } else {
          base.add(id);
        }
        return base;
      });
    },
    [messages],
  );

  const youLabel = t('export.you');
  const assistantLabel = t('export.assistant');

  const handleExportPdf = useCallback(() => {
    const selected = getSelectedMessages(messages, effectiveSelected);
    if (selected.length === 0) return;
    printViaIframe(selected, t('export.title'), youLabel, assistantLabel);
    onOpenChange(false);
  }, [messages, effectiveSelected, onOpenChange, t, youLabel, assistantLabel]);

  const handleExportMarkdown = useCallback(() => {
    const selected = getSelectedMessages(messages, effectiveSelected);
    if (selected.length === 0) return;
    const markdown = formatMessagesAsMarkdown(
      selected,
      youLabel,
      assistantLabel,
    );
    triggerFileDownload(
      markdown,
      'chat-export.md',
      'text/markdown;charset=utf-8',
    );
    onOpenChange(false);
  }, [messages, effectiveSelected, onOpenChange, youLabel, assistantLabel]);

  const truncate = (text: string, maxLen = 80) =>
    text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('export.title')}
      description={t('export.description')}
      icon={<Download className="text-muted-foreground size-5" />}
      size="lg"
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportMarkdown}
            disabled={noneSelected}
            className="gap-1.5"
          >
            <FileText className="size-3.5" />
            {t('export.downloadMarkdown')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportPdf}
            disabled={noneSelected}
            className="gap-1.5"
          >
            <FileText className="size-3.5" />
            {t('export.downloadPdf')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Text variant="label" className="text-sm">
            {t('export.messagesCount', {
              count: effectiveSelected.size,
              total: messages.length,
            })}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleAll}
            className="text-xs"
          >
            {allSelected ? t('export.deselectAll') : t('export.selectAll')}
          </Button>
        </div>

        <div className="border-border max-h-80 overflow-y-auto rounded-lg border">
          {messages.map((msg) => (
            <button
              key={msg._id}
              type="button"
              className="hover:bg-accent flex w-full cursor-pointer items-start gap-3 border-b px-3 py-2 text-left last:border-b-0"
              onClick={() => handleToggleMessage(msg._id)}
            >
              <div className="pointer-events-none mt-0.5">
                <Checkbox
                  checked={effectiveSelected.has(msg._id)}
                  tabIndex={-1}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Text variant="label" className="text-xs">
                  {msg.role === 'user'
                    ? t('export.you')
                    : t('export.assistant')}
                </Text>
                <Text
                  variant="muted"
                  className="line-clamp-2 text-xs leading-relaxed"
                >
                  {truncate(msg.content, 120)}
                </Text>
              </div>
            </button>
          ))}
          {messages.length === 0 && (
            <div className="px-3 py-4 text-center">
              <Text variant="muted" className="text-sm">
                {t('export.noMessages')}
              </Text>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function ExportChatDialog(props: ExportChatDialogProps) {
  if (!props.open) return null;
  return <ExportChatDialogContent {...props} />;
}
