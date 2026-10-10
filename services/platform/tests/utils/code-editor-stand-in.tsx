/**
 * `@tale/ui/code-editor` as the jsdom suites see it: a plain text box with
 * the editor's contract — the same props, the value as its own state while
 * mounted (an external value replaces it), Field labelling through
 * `aria-labelledby`, and "go to" a problem selecting its range, or the part
 * of a JSON or YAML value a request names.
 *
 * jsdom has no layout, so CodeMirror cannot be driven there; the real
 * editor is proven in Chromium (`*.browser.test.tsx`). What a host passes
 * the editor — language, diagnostics, providers — is on the box as data
 * attributes, for a suite to read.
 */

import type { CodeEditorHandle, CodeEditorProps } from '@tale/ui/code-editor';
import {
  locateJsonPointer,
  locateYamlPointer,
} from '@tale/ui/code-editor/locate';
import { useIssueFocusTarget, type IssueFocusPart } from '@tale/ui/issue-focus';
import {
  forwardRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';

export type {
  CodeEditorDiagnostic,
  CodeEditorDiagnosticsStatus,
  CodeEditorHandle,
  CodeEditorProps,
  CodeLanguage,
} from '@tale/ui/code-editor';

function partRange(
  props: CodeEditorProps,
  text: string,
  part: IssueFocusPart | undefined,
): readonly [number, number] | undefined {
  if (part === undefined) return undefined;
  const options = part.range === undefined ? {} : { range: part.range };
  const located =
    props.language === 'json'
      ? locateJsonPointer(text, part.rest, options)
      : props.language === 'yaml'
        ? locateYamlPointer(text, part.rest, options)
        : null;
  return located === null ? undefined : [located.from, located.to];
}

const CodeEditorStandIn = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditorStandIn(props, ref) {
    const { value, onChange, singleLine = false } = props;
    const [text, setText] = useState(value);
    const shown = useRef(value);
    useEffect(() => {
      if (value !== shown.current) {
        shown.current = value;
        setText(value);
      }
    }, [value]);
    const boxRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

    const latest = useRef(props);
    useLayoutEffect(() => {
      latest.current = props;
    });
    const focus = useCallback(
      (range?: readonly [number, number], part?: IssueFocusPart): void => {
        const box = boxRef.current;
        if (box === null) return;
        box.focus({ preventScroll: true });
        const target = range ?? partRange(latest.current, box.value, part);
        if (target !== undefined) box.setSelectionRange(target[0], target[1]);
      },
      [],
    );
    useIssueFocusTarget(
      props.issueAnchor ?? null,
      { focus },
      props.issueReveal === undefined
        ? undefined
        : { reveal: props.issueReveal },
    );
    useImperativeHandle(
      ref,
      () => ({
        focus: (range) => focus(range),
        getSelection: () => {
          const box = boxRef.current;
          return box === null
            ? null
            : [box.selectionStart ?? 0, box.selectionEnd ?? 0];
        },
        openCompletion: () => undefined,
        nextDiagnostic: () => undefined,
        view: null,
      }),
      [focus],
    );

    const common = {
      id: props.id,
      'aria-label': props['aria-label'],
      'aria-labelledby': props['aria-labelledby'],
      'aria-describedby': props['aria-describedby'],
      'aria-invalid': props['aria-invalid'],
      'aria-required': props.required,
      'aria-readonly': props.readOnly,
      readOnly: props.readOnly === true || props.disabled === true,
      placeholder: props.placeholder,
      value: text,
      className: props.className,
      'data-code-editor': '',
      'data-language': props.language,
      'data-templates': props.templates === true ? '' : undefined,
      'data-diagnostics': JSON.stringify(
        (props.diagnostics ?? []).map((diagnostic) => ({
          id: diagnostic.id,
          severity: diagnostic.severity,
          message: diagnostic.message,
          range: diagnostic.range,
          fixes: diagnostic.fixes?.map((fix) => fix.label),
        })),
      ),
      'data-diagnostics-status': props.diagnosticsStatus,
      onFocus: props.onFocus,
      onBlur: props.onBlur,
    };
    const edit = (next: string): void => {
      shown.current = next;
      setText(next);
      onChange?.(next);
    };
    return singleLine ? (
      <input
        ref={boxRef}
        {...common}
        onChange={(event) => edit(event.target.value.replaceAll('\n', ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSubmit?.(text);
        }}
      />
    ) : (
      <textarea
        ref={boxRef}
        {...common}
        rows={props.minRows ?? 3}
        onChange={(event) => edit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            props.onSubmit?.(text);
          }
        }}
      />
    );
  },
);

export const CodeEditor: ForwardRefExoticComponent<
  CodeEditorProps & RefAttributes<CodeEditorHandle>
> & { fieldLabelling: 'labelledby' } = Object.assign(CodeEditorStandIn, {
  fieldLabelling: 'labelledby' as const,
});

export function preloadCodeEditor(): void {
  // Nothing to load: the stand-in is the whole editor.
}
