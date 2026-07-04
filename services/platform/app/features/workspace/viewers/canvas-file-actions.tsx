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
  // These are icon-only `size="sm"` buttons; the Button only maps `title` to
  // the accessible name for the `icon`/`icon-sm` sizes, so name them explicitly
  // with `aria-label` (title still drives the hover/focus tooltip).
  const label = t('canvas.toggleWrap', { defaultValue: 'Toggle line wrap' });
  return (
    <Button
      variant={wrap ? 'secondary' : 'ghost'}
      size="sm"
      icon={WrapText}
      onClick={onToggle}
      aria-pressed={wrap}
      aria-label={label}
      title={label}
    />
  );
}

/** Copy the file's text content to the clipboard, with a transient check mark. */
export function CopyAction({ content }: { content: string }) {
  const { t } = useT('chat');
  const { copied, onClick } = useCopyButton(content);
  const label = copied
    ? t('canvas.copied', { defaultValue: 'Copied' })
    : t('canvas.copy', { defaultValue: 'Copy' });
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? Check : Copy}
      onClick={onClick}
      aria-label={label}
      title={label}
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
  const label = t('canvas.download', { defaultValue: 'Download' });
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Download}
      onClick={() => downloadTextFile(basename(path), content)}
      aria-label={label}
      title={label}
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
  const label = t('canvas.download', { defaultValue: 'Download' });
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
      aria-label={label}
      title={label}
    />
  );
}
