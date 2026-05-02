import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';

import {
  CanvasHtmlRenderer,
  type CanvasHtmlRendererHandle,
} from '../canvas-html-renderer';

describe('CanvasHtmlRenderer', () => {
  test('renders a hidden form pointing at /canvas-preview targeting the iframe', () => {
    render(
      <CanvasHtmlRenderer
        html="<p>hi</p>"
        isEditing={false}
        onContentChange={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle('HTML preview') as HTMLIFrameElement;
    // No `srcdoc` and no `src` — the iframe is navigated by the form
    // submission below, NOT by an initial GET. (srcdoc inherits the
    // SPA's nonce-based CSP, the original source of the bug.)
    expect(iframe.getAttribute('srcdoc')).toBeNull();
    expect(iframe.getAttribute('src')).toBeNull();
    // `allow-scripts` without `allow-same-origin` keeps the iframe in an
    // opaque origin so AI HTML cannot reach parent storage / cookies.
    // `allow-modals` is required so window.print() (PDF export path)
    // actually opens the print dialog.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-modals');
    expect(iframe.getAttribute('name')).toMatch(/^canvas-preview-/);

    const form = iframe.previousElementSibling as HTMLFormElement;
    expect(form.tagName).toBe('FORM');
    expect(form.method).toBe('post');
    expect(form.getAttribute('action')).toBe('/canvas-preview');
    expect(form.target).toBe(iframe.getAttribute('name'));
  });

  test('writes the html into the form input and submits on render', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    submit.mockImplementation(() => {
      /* jsdom has no real submit; observe the call only. */
    });
    render(
      <CanvasHtmlRenderer
        html="<h1>fib</h1>"
        isEditing={false}
        onContentChange={vi.fn()}
      />,
    );
    const form = document.querySelector('form') as HTMLFormElement;
    const input = form.querySelector(
      'textarea[name="html"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe('<h1>fib</h1>');
    expect(submit).toHaveBeenCalledTimes(1);
    submit.mockRestore();
  });

  test('re-submits when html changes', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    submit.mockImplementation(() => {
      /* jsdom has no real submit; observe the call only. */
    });
    const { rerender } = render(
      <CanvasHtmlRenderer
        html="<h1>v1</h1>"
        isEditing={false}
        onContentChange={vi.fn()}
      />,
    );
    expect(submit).toHaveBeenCalledTimes(1);
    rerender(
      <CanvasHtmlRenderer
        html="<h1>v2</h1>"
        isEditing={false}
        onContentChange={vi.fn()}
      />,
    );
    expect(submit).toHaveBeenCalledTimes(2);
    const input = document.querySelector(
      'textarea[name="html"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe('<h1>v2</h1>');
    submit.mockRestore();
  });

  test('requestPrint() postMessages the print signal to the iframe', () => {
    const ref = createRef<CanvasHtmlRendererHandle>();
    render(
      <CanvasHtmlRenderer
        ref={ref}
        html="<p>x</p>"
        isEditing={false}
        onContentChange={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle('HTML preview') as HTMLIFrameElement;
    const postMessage = vi.fn();
    // jsdom gives the iframe a contentWindow; spy on its postMessage.
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      value: postMessage,
      configurable: true,
    });
    ref.current?.requestPrint();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'tale:canvas:print' },
      '*',
    );
  });

  test('renders the textarea (no iframe / form) in editing mode', async () => {
    const onChange = vi.fn();
    render(
      <CanvasHtmlRenderer
        html="<p>hi</p>"
        isEditing={true}
        onContentChange={onChange}
      />,
    );
    const textarea = screen.getByLabelText('HTML editor');
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(screen.queryByTitle('HTML preview')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    await userEvent.type(textarea, 'X');
    expect(onChange).toHaveBeenCalled();
  });
});
