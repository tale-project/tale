'use client';

/**
 * `@tale/ui/code-editor` — the one control for code, JSON, YAML, prompts and
 * `{{ js }}` templates: highlighting in the shared AA palette, the keyboard
 * model that never traps (Esc, then Tab leaves), and a place for a host's
 * completion, hover and problems.
 *
 * This module is light: types, the frame, a same-size placeholder while the
 * CodeMirror implementation (`code-editor-view.tsx`) loads, the Field and
 * issue-focus wiring. Nothing here imports CodeMirror, so a page that
 * renders no code field never downloads it.
 */

import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';

import { useIsMac } from '../../../hooks/use-is-mac';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../../overlays/disabled-reason';
import { FIELD_FOCUS_WITHIN, FIELD_INVALID_WITHIN } from '../field-focus';
import {
  useIssueFocusTarget,
  type IssueFocusPart,
  type IssueFocusRange,
} from '../issue-focus';
import type { CodeEditorViewHandle } from './code-editor-view';
import type { CodeEditorHandle, CodeEditorProps } from './types';

export type {
  CodeEditorDiagnostic,
  CodeEditorDiagnosticsStatus,
  CodeEditorHandle,
  CodeEditorProps,
} from './types';
export type { CodeLanguage } from '../../../lib/code-roles';

const loadView = () => import('./code-editor-view');
const CodeEditorView = lazy(loadView);

/**
 * Starts loading the editor's implementation, so the first code field a
 * reader opens is ready. Idempotent and fire-and-forget; call it when a
 * surface that is likely to show code mounts, or on hover of what opens it.
 */
export function preloadCodeEditor(): void {
  loadView().catch((error: unknown) => {
    console.warn('[code-editor] preload failed', error);
  });
}

/* Whether the reader is using the keyboard, for the shortcut legend: it
   shows after a keyboard focus or a key press, never after a click. */
let lastInput: 'keyboard' | 'pointer' = 'pointer';
let modalityListeners = false;
function trackModality(): void {
  if (modalityListeners || typeof document === 'undefined') return;
  modalityListeners = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey && !event.ctrlKey) lastInput = 'keyboard';
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    () => {
      lastInput = 'pointer';
    },
    true,
  );
}

const SIZE_CLASS = {
  sm: 'text-base md:text-xs',
  md: 'text-base md:text-sm',
} as const;

const CODE_LANGUAGES = new Set(['javascript', 'expression', 'json', 'yaml']);

interface PendingFocus {
  range: IssueFocusRange | undefined;
  part: IssueFocusPart | undefined;
}

const CodeEditorBase = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(props, ref) {
    const {
      value,
      language,
      readOnly = false,
      disabled = false,
      disabledReason,
      placeholder,
      singleLine = false,
      minRows = singleLine ? 1 : 3,
      maxRows = singleLine ? 4 : 14,
      fillHeight = false,
      wrap,
      font = 'mono',
      size = 'sm',
      lineNumbers = false,
      onSubmit,
      submitLabel,
      issueAnchor = null,
      issueReveal,
      className,
    } = props;
    const { t } = useT('codeEditor');
    const isMac = useIsMac();
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const baseId = useId();
    const keyboardHintId = `${baseId}-keyboard`;
    const submitHintId = `${baseId}-submit`;
    const softDisabled = disabled && hasDisabledReason(disabledReason);
    const editable = !readOnly && !disabled;
    const capturesTab = editable && !singleLine;
    const shortcut = isMac ? '⌘↵' : 'Ctrl+Enter';
    const canSubmit = onSubmit !== undefined && submitLabel !== undefined;
    const invalid = props['aria-invalid'] === true;

    const describedBy =
      [
        props['aria-describedby'],
        capturesTab ? keyboardHintId : undefined,
        canSubmit ? submitHintId : undefined,
      ]
        .filter(Boolean)
        .join(' ') || undefined;

    const viewHandle = useRef<CodeEditorViewHandle | null>(null);
    const pending = useRef<PendingFocus | null>(null);
    const [loaded, setLoaded] = useState(false);

    const onView = useCallback((handle: CodeEditorViewHandle | null) => {
      viewHandle.current = handle;
      setLoaded(handle !== null);
      if (handle === null) return;
      const request = pending.current;
      pending.current = null;
      if (request !== null) handle.focus(request.range, request.part);
    }, []);

    const focus = useCallback(
      (range?: IssueFocusRange, part?: IssueFocusPart) => {
        const handle = viewHandle.current;
        if (handle !== null) handle.focus(range, part);
        else pending.current = { range, part };
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: (range) => focus(range),
        getSelection: () => viewHandle.current?.getSelection() ?? null,
        openCompletion: () => viewHandle.current?.openCompletion(),
        nextDiagnostic: (direction = 1) =>
          viewHandle.current?.nextDiagnostic(direction),
        get view() {
          return viewHandle.current?.view ?? null;
        },
      }),
      [focus],
    );

    // Go-to from a problems list: the range is offsets into `value`; a part
    // of a JSON or YAML value is found in the text by the view.
    useIssueFocusTarget(
      issueAnchor,
      { focus },
      issueReveal === undefined ? undefined : { reveal: issueReveal },
    );

    // The shortcut legend follows keyboard use inside the frame.
    const frameRef = useRef<HTMLDivElement>(null);
    const [keyboardFocus, setKeyboardFocus] = useState(false);
    useEffect(() => {
      trackModality();
      const frame = frameRef.current;
      if (frame === null) return undefined;
      const onFocusIn = () => {
        if (lastInput === 'keyboard') setKeyboardFocus(true);
      };
      const onKeyDown = () => setKeyboardFocus(true);
      const onFocusOut = (event: FocusEvent) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !frame.contains(next)) {
          setKeyboardFocus(false);
        }
      };
      frame.addEventListener('focusin', onFocusIn);
      frame.addEventListener('keydown', onKeyDown);
      frame.addEventListener('focusout', onFocusOut);
      return () => {
        frame.removeEventListener('focusin', onFocusIn);
        frame.removeEventListener('keydown', onKeyDown);
        frame.removeEventListener('focusout', onFocusOut);
      };
    }, []);

    const frameStyle = {
      '--ce-min-rows': String(minRows),
      '--ce-max-rows': String(maxRows),
    } as CSSProperties;

    const isCode = CODE_LANGUAGES.has(language);
    const wraps = wrap ?? (singleLine || !isCode);

    const frame = (
      <div
        data-code-editor=""
        data-vaul-no-drag=""
        aria-busy={loaded ? undefined : true}
        style={frameStyle}
        ref={frameRef}
        className={cn(
          'group/code-editor bg-background @container relative w-full min-w-0 rounded-md border border-(--color-border-input) transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
          SIZE_CLASS[size],
          !readOnly && !disabled && FIELD_FOCUS_WITHIN,
          readOnly && 'border-border-base bg-bg-elevated',
          readOnly && FIELD_FOCUS_WITHIN,
          disabled &&
            'cursor-not-allowed bg-[color:var(--color-bg-elevated)] text-[color:var(--color-fg-subtle)] [&_.cm-content]:opacity-70',
          invalid && FIELD_INVALID_WITHIN,
          fillHeight && 'flex h-full min-h-0 flex-1 flex-col',
          className,
        )}
      >
        <Suspense
          fallback={
            <LoadingText
              value={value}
              placeholder={placeholder}
              wraps={wraps}
              font={font}
              lineNumbers={lineNumbers}
              minRows={minRows}
              maxRows={maxRows}
              fillHeight={fillHeight}
              loadingLabel={t('loading')}
            />
          }
        >
          <CodeEditorView
            {...props}
            describedBy={describedBy}
            reducedMotion={reducedMotion}
            onView={onView}
          />
        </Suspense>
        {capturesTab ? (
          <span id={keyboardHintId} hidden>
            {t('keyboardHint')}
          </span>
        ) : null}
        {canSubmit ? (
          <span id={submitHintId} hidden>
            {t('submitHint', { shortcut, action: submitLabel })}
          </span>
        ) : null}
        {capturesTab && keyboardFocus ? (
          <span
            aria-hidden="true"
            data-code-editor-legend=""
            className="bg-background text-muted-foreground border-border motion-safe:animate-in motion-safe:fade-in pointer-events-none absolute right-2 -bottom-2.5 hidden h-5 items-center gap-2 rounded-sm border px-1.5 text-xs whitespace-nowrap motion-safe:duration-[var(--duration-short)] @min-[16rem]:inline-flex"
          >
            {canSubmit ? (
              <span>
                {t('legend.submit', { shortcut, action: submitLabel })}
              </span>
            ) : null}
            <span>{t('legend.leave')}</span>
          </span>
        ) : null}
      </div>
    );

    return (
      <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
        {frame}
      </DisabledReasonTooltip>
    );
  },
);

/**
 * What shows while the editor's implementation loads: the value in the
 * editor's own metrics, so nothing moves when the editor replaces it.
 */
function LoadingText({
  value,
  placeholder,
  wraps,
  font,
  lineNumbers,
  minRows,
  maxRows,
  fillHeight,
  loadingLabel,
}: {
  value: string;
  placeholder: string | undefined;
  wraps: boolean;
  font: 'mono' | 'prose';
  lineNumbers: boolean;
  minRows: number;
  maxRows: number;
  fillHeight: boolean;
  loadingLabel: string;
}) {
  const shown = value === '' ? (placeholder ?? '') : value;
  return (
    <>
      <pre
        aria-hidden="true"
        data-code-editor-loading=""
        className={cn(
          'm-0 box-border overflow-auto py-2 pr-3 leading-[1.6]',
          lineNumbers ? 'pl-[3.25rem]' : 'pl-3',
          font === 'prose' ? 'font-sans' : 'font-mono',
          wraps ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
          value === '' && 'text-muted-foreground',
          fillHeight && 'h-full min-h-0',
        )}
        style={{
          minHeight: `calc(${minRows} * 1.6em + 1rem)`,
          ...(fillHeight
            ? {}
            : { maxHeight: `calc(${maxRows} * 1.6em + 1rem)` }),
        }}
      >
        {/* A trailing line break opens an empty last line in the editor. */}
        {shown.endsWith('\n') ? `${shown} ` : shown}
      </pre>
      <span className="sr-only">{loadingLabel}</span>
    </>
  );
}

/**
 * Edit code, JSON, YAML, Markdown prompts and `{{ js }}` templates. Put it
 * in a `Field`: the label names it (`aria-labelledby`), the field's problems
 * describe it.
 */
export const CodeEditor: ForwardRefExoticComponent<
  CodeEditorProps & RefAttributes<CodeEditorHandle>
> & { fieldLabelling: 'labelledby' } = Object.assign(CodeEditorBase, {
  fieldLabelling: 'labelledby' as const,
});
