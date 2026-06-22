'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@tale/ui/responsive-dialog';
import { Spinner } from '@tale/ui/spinner';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useT } from '@/lib/i18n/client';

/** Output files we render as formatted markdown in an in-place preview dialog
 * rather than punting the user to a raw new-tab download (e.g. the harvested
 * `summary.md`). */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];

export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Best-effort guard against pulling a multi-MB blob over the wire just to render
// it as text. Only fires when the response advertises Content-Length — which the
// same-origin Convex storage proxy does, since it serves fixed-size stored blobs.
const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024;

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error' };

/**
 * A harvested output `.md` file rendered as a button that opens a dialog and
 * shows the file as formatted markdown in place. The body is fetched lazily the
 * first time the dialog opens (and re-fetched on each re-open) from the resolved
 * storage url — same-origin through the proxy, so no extra auth is needed.
 */
export function MarkdownFilePreview({
  file,
}: {
  file: { name: string; url: string };
}) {
  const { t } = useT('operator');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentLength = Number(res.headers.get('content-length') ?? 0);
        if (contentLength > TEXT_PREVIEW_LIMIT) {
          if (!cancelled) setState({ status: 'error' });
          return;
        }
        const text = await res.text();
        if (!cancelled) setState({ status: 'ready', text });
      } catch (err) {
        console.warn('Failed to load markdown preview', err);
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file.url]);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="secondary" size="sm" icon={FileText}>
          {t('action.openFile', { name: file.name, defaultValue: file.name })}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="max-w-3xl">
        <ResponsiveDialogTitle>{file.name}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">
          {t('filePreview.description', {
            name: file.name,
            defaultValue: `Preview of ${file.name}`,
          })}
        </ResponsiveDialogDescription>
        <div className="mt-2 max-h-[70vh] overflow-y-auto">
          {state.status === 'loading' && (
            <Row gap={0} align="stretch" justify="center" className="py-12">
              <Spinner
                label={t('filePreview.loading', {
                  defaultValue: 'Loading preview…',
                })}
              />
            </Row>
          )}
          {state.status === 'error' && (
            <div className="text-muted-foreground space-y-3 py-8 text-center text-sm">
              <p>
                {t('filePreview.error', {
                  defaultValue: "Couldn't load the preview.",
                })}
              </p>
              <Button asChild variant="secondary" size="sm">
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  {t('filePreview.openInNewTab', {
                    defaultValue: 'Open in a new tab',
                  })}
                </a>
              </Button>
            </div>
          )}
          {state.status === 'ready' && <MarkdownContent content={state.text} />}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
