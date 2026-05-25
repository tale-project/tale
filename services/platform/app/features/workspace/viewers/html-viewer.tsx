'use client';

import { memo, useId, useLayoutEffect, useRef } from 'react';

import { getEnv } from '@/lib/env';

interface HtmlViewerProps {
  html: string;
}

/**
 * Sandboxed iframe HTML preview. The html is posted to `/canvas-preview`
 * which echoes it back with a permissive CSP header — we get a fresh
 * Document AND a fresh JS realm per render so user-script `let X = …` on
 * render N never collides with render N+1's `let X`. (See
 * `lib/canvas-preview-shell.ts` for the full why-not-srcdoc rationale.)
 */
function HtmlViewerComponent({ html }: HtmlViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const htmlInputRef = useRef<HTMLTextAreaElement>(null);

  // Each renderer instance gets a unique iframe `name` so the form's
  // `target` resolves to this iframe and not some other frame on the page.
  const iframeName = `workspace-preview-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useLayoutEffect(() => {
    const form = formRef.current;
    const input = htmlInputRef.current;
    if (!form || !input) return;
    input.value = html;
    form.submit();
  }, [html]);

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
        // `allow-modals` is required for any in-document `window.print()`.
        sandbox="allow-scripts allow-modals"
        title="HTML preview"
        className="h-full w-full border-0 bg-white"
      />
    </>
  );
}

export const HtmlViewer = memo(HtmlViewerComponent);
