'use client';

import { Button } from '@tale/ui/button';
import { Check, Copy, Download, WrapText } from 'lucide-react';
import { useState } from 'react';

import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { downloadTextFile, downloadUrlFile } from '@/lib/utils/download';

/** Last path segment — the name the user expects in the "Save as" dialog. */
function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Toggle long-line wrapping. Shown for code and the source view of renderables. */
export function WrapAction({
  wrap,
  onToggle,
}: {
  wrap: boolean;
  onToggle: () => void;
}) {
  const { t } = useT('chat');
  return (
    <Button
      variant={wrap ? 'secondary' : 'ghost'}
      size="sm"
      icon={WrapText}
      onClick={onToggle}
      aria-pressed={wrap}
      title={t('canvas.toggleWrap', { defaultValue: 'Toggle line wrap' })}
    />
  );
}

/** Copy the file's text content to the clipboard, with a transient check mark. */
export function CopyAction({ content }: { content: string }) {
  const { t } = useT('chat');
  const { copied, onClick } = useCopyButton(content);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? Check : Copy}
      onClick={onClick}
      title={
        copied
          ? t('canvas.copied', { defaultValue: 'Copied' })
          : t('canvas.copy', { defaultValue: 'Copy' })
      }
    />
  );
}

/** Download in-memory text (code/markdown/svg/html source). */
export function DownloadTextAction({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const { t } = useT('chat');
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Download}
      onClick={() => downloadTextFile(basename(path), content)}
      title={t('canvas.download', { defaultValue: 'Download' })}
    />
  );
}

/** Download a remote file (an image's object/storage URL). */
export function DownloadUrlAction({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const { t } = useT('chat');
  const [busy, setBusy] = useState(false);
  const handleDownload = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await downloadUrlFile(filename, url);
    } catch (err) {
      console.error('Canvas download failed:', err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Download}
      isLoading={busy}
      onClick={() => void handleDownload()}
      title={t('canvas.download', { defaultValue: 'Download' })}
    />
  );
}
