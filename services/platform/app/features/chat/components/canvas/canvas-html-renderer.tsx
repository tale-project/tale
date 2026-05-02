'use client';

import {
  forwardRef,
  memo,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

import { getEnv } from '@/lib/env';
import { cn } from '@/lib/utils/cn';

export interface CanvasHtmlRendererHandle {
  // postMessage `tale:canvas:print` into the iframe; the shell listener
  // (lib/canvas-preview-shell.ts) calls window.print() on receipt. The
  // parent cannot call iframe.contentWindow.print() directly — the sandbox
  // runs without `allow-same-origin`, so cross-realm access throws.
  requestPrint: () => void;
}

interface CanvasHtmlRendererProps {
  html: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function CanvasHtmlRendererComponent(
  { html, isEditing, onContentChange }: CanvasHtmlRendererProps,
  ref: React.Ref<CanvasHtmlRendererHandle>,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const htmlInputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      requestPrint: () => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'tale:canvas:print' },
          '*',
        );
      },
    }),
    [],
  );

  // Each renderer instance gets a unique iframe `name` so the form's
  // `target` resolves to this iframe and not some other frame on the page.
  const iframeName = `canvas-preview-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Submit the html to /canvas-preview as a form POST. The server returns
  // the html wrapped in a doctype with a permissive CSP header, the iframe
  // navigates to the response, and we get a fresh Document AND a fresh JS
  // realm — so user-script `let X = …` on render N never collides with
  // render N+1's `let X`. (See lib/canvas-preview-shell.ts header for the
  // full why-not-srcdoc / why-not-document.write rationale.)
  //
  // `useLayoutEffect` (not `useEffect`) submits before paint, so the iframe
  // doesn't briefly show stale content on edit-apply or content swap.
  useLayoutEffect(() => {
    if (isEditing) return;
    const form = formRef.current;
    const input = htmlInputRef.current;
    if (!form || !input) return;
    input.value = html;
    form.submit();
  }, [html, isEditing]);

  if (isEditing) {
    return (
      <textarea
        value={html}
        onChange={(e) => onContentChange(e.target.value)}
        className={cn(
          'bg-muted text-foreground h-full w-full resize-none p-4 font-mono text-xs leading-relaxed',
          'focus:outline-none',
        )}
        spellCheck={false}
        aria-label="HTML editor"
      />
    );
  }

  const action = `${getEnv('BASE_PATH')}/canvas-preview`;

  return (
    <>
      <form
        ref={formRef}
        method="post"
        action={action}
        target={iframeName}
        encType="application/x-www-form-urlencoded"
        hidden
      >
        <textarea ref={htmlInputRef} name="html" defaultValue="" />
      </form>
      <iframe
        ref={iframeRef}
        name={iframeName}
        // `allow-modals` is required for `window.print()` to actually open
        // the print dialog — the spec gates print, alert, confirm, prompt,
        // and beforeunload modals on this flag. Used by the toolbar's
        // "Export as PDF" action via `requestPrint()`.
        sandbox="allow-scripts allow-modals"
        title="HTML preview"
        className="h-full w-full border-0 bg-white"
      />
    </>
  );
}

export const CanvasHtmlRenderer = memo(forwardRef(CanvasHtmlRendererComponent));
