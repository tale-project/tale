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

import { Maximize2 } from 'lucide-react';
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';

import { useIsMac } from '../../../hooks/use-is-mac';
import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';
import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { ErrorBoundaryBase } from '../../error-boundaries/core/error-boundary-base';
import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../../overlays/disabled-reason';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '../../overlays/responsive-dialog';
import { Button } from '../../primitives/button';
import { IconButton } from '../../primitives/icon-button';
import { FIELD_FOCUS_WITHIN, FIELD_INVALID_WITHIN } from '../field-focus';
import {
  useIssueFocusTarget,
  type IssueFocusPart,
  type IssueFocusRange,
} from '../issue-focus';
import type { CodeEditorViewHandle } from './code-editor-view';
import type {
  CodeEditorDiagnostic,
  CodeEditorHandle,
  CodeEditorProps,
} from './types';

export type {
  CodeEditorDiagnostic,
  CodeEditorDiagnosticsStatus,
  CodeEditorHandle,
  CodeEditorProps,
} from './types';
export type { CodeLanguage } from '../../../lib/code-roles';

const loadView = () => import('./code-editor-view');
/** The editor's implementation, shared by every field. React keeps a lazy
 * component whose load failed failed for good, so a retry swaps in a fresh
 * one (`retryView`). */
let CodeEditorView = lazy(loadView);
let viewFailed = false;
function retryView(): void {
  if (!viewFailed) return;
  viewFailed = false;
  CodeEditorView = lazy(loadView);
}

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

/** The line `offset` is on, 1-based. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < Math.min(offset, text.length); i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * The words a screen reader hears for a field's problems: the count, then
 * the first three with their lines.
 */
function useProblemSummary(
  diagnostics: readonly CodeEditorDiagnostic[] | undefined,
  text: string,
  ready: boolean,
): string {
  const { t } = useT('codeEditor');
  const { t: tIssues } = useT('issues');
  const settled = useRef('');
  return useMemo(() => {
    if (!ready) return settled.current;
    const list = diagnostics ?? [];
    if (list.length === 0) {
      settled.current = '';
      return '';
    }
    const errors = list.filter((d) => d.severity === 'error').length;
    const warnings = list.filter((d) => d.severity === 'warning').length;
    const parts = [
      `${tIssues('summary', { errors, warnings })}.`,
      ...list.slice(0, 3).map((d) =>
        t('diagnostics.lineItem', {
          line: lineOf(text, d.range?.[0] ?? 0),
          message: d.message,
        }),
      ),
    ];
    if (list.length > 3) {
      parts.push(`${t('diagnostics.more', { count: list.length - 3 })}.`);
    }
    settled.current = parts.join(' ');
    return settled.current;
  }, [diagnostics, text, ready, t, tIssues]);
}

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
      expandable = false,
      describeDiagnostics = true,
      className,
    } = props;
    const { t } = useT('codeEditor');
    const isMac = useIsMac();
    const reducedMotion = usePrefersReducedMotion();
    const baseId = useId();
    const keyboardHintId = `${baseId}-keyboard`;
    const submitHintId = `${baseId}-submit`;
    const summaryId = `${baseId}-summary`;
    const softDisabled = disabled && hasDisabledReason(disabledReason);
    const editable = !readOnly && !disabled;
    const capturesTab = editable && !singleLine;
    const shortcut = isMac ? '⌘↵' : 'Ctrl+Enter';
    const canSubmit = onSubmit !== undefined && submitLabel !== undefined;
    const invalid = props['aria-invalid'] === true;
    const summary = useProblemSummary(
      props.diagnostics,
      props.diagnosticsFor ?? value,
      (props.diagnosticsStatus ?? 'ready') === 'ready',
    );
    const summarize = describeDiagnostics && summary !== '';

    const describedBy =
      [
        props['aria-describedby'],
        summarize ? summaryId : undefined,
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

    // Expand: the same field in a large dialog, the caret carried both ways.
    const [expanded, setExpanded] = useState(false);
    const [expandSelection, setExpandSelection] = useState<
      readonly [number, number] | undefined
    >(undefined);
    const expandedEditor = useRef<CodeEditorHandle>(null);
    const expandTitle =
      typeof expandable === 'object'
        ? expandable.title
        : (props['aria-label'] ?? t('expand'));
    const openExpanded = () => {
      setExpandSelection(viewHandle.current?.getSelection() ?? undefined);
      setExpanded(true);
    };
    useEffect(() => {
      if (!expanded) return undefined;
      // Into the large editor, at the caret the field had.
      const frame = requestAnimationFrame(() =>
        expandedEditor.current?.focus(expandSelection),
      );
      return () => cancelAnimationFrame(frame);
    }, [expanded, expandSelection]);
    const closeExpanded = () => {
      const selection = expandedEditor.current?.getSelection() ?? undefined;
      setExpanded(false);
      // Back in the field, with the caret where the dialog left it.
      requestAnimationFrame(() => focus(selection));
    };

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
          expandable !== false && '[&_.cm-content]:pr-7',
          className,
        )}
      >
        {/* A failed load stays in the field: the value goes on in plain
            text, and the page around it — a draft — keeps working. */}
        <ErrorBoundaryBase
          onError={(error) => {
            viewFailed = true;
            console.warn('[code-editor] the editor did not load', error);
          }}
          onReset={retryView}
          fallback={({ reset }) => (
            <PlainTextFallback
              value={value}
              onChange={props.onChange}
              editable={editable}
              placeholder={placeholder}
              font={font}
              minRows={minRows}
              maxRows={maxRows}
              fillHeight={fillHeight}
              id={props.id}
              label={props['aria-label']}
              labelledBy={props['aria-labelledby']}
              describedBy={props['aria-describedby']}
              invalid={invalid}
              onRetry={reset}
            />
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
        </ErrorBoundaryBase>
        {expandable !== false ? (
          <IconButton
            icon={Maximize2}
            iconSize={3}
            size="sm"
            aria-label={t('expand')}
            onClick={openExpanded}
            className="absolute top-1 right-1 z-10 size-6 opacity-0 transition-opacity duration-[var(--duration-short)] group-focus-within/code-editor:opacity-100 group-hover/code-editor:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
          />
        ) : null}
        {summarize ? (
          <span id={summaryId} hidden>
            {summary}
          </span>
        ) : null}
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
      <>
        <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
          {frame}
        </DisabledReasonTooltip>
        {expandable !== false ? (
          <ResponsiveDialog
            open={expanded}
            onOpenChange={(open) => {
              if (open) setExpanded(true);
              else closeExpanded();
            }}
          >
            <ResponsiveDialogContent
              preventCloseAutoFocus
              onOpenAutoFocus={(event) => event.preventDefault()}
              className="flex h-[85dvh] flex-col gap-3 md:h-[80dvh] md:max-w-4xl"
            >
              <ResponsiveDialogTitle>{expandTitle}</ResponsiveDialogTitle>
              {expanded ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <CodeEditorBase
                    {...props}
                    ref={expandedEditor}
                    id={undefined}
                    issueAnchor={null}
                    expandable={false}
                    className={undefined}
                    aria-label={expandTitle}
                    aria-labelledby={undefined}
                    size="md"
                    lineNumbers
                    fold
                    fillHeight
                    initialSelection={expandSelection}
                  />
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeExpanded}
                >
                  {t('collapse')}
                </Button>
              </div>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        ) : null}
      </>
    );
  },
);

/**
 * What a field shows when the editor's implementation could not load: the
 * same value in a plain text area, still edited through `onChange`, and a
 * way to try the editor again.
 */
function PlainTextFallback({
  value,
  onChange,
  editable,
  placeholder,
  font,
  minRows,
  maxRows,
  fillHeight,
  id,
  label,
  labelledBy,
  describedBy,
  invalid,
  onRetry,
}: {
  value: string;
  onChange: ((value: string) => void) | undefined;
  editable: boolean;
  placeholder: string | undefined;
  font: 'mono' | 'prose';
  minRows: number;
  maxRows: number;
  fillHeight: boolean;
  id: string | undefined;
  label: string | undefined;
  labelledBy: string | undefined;
  describedBy: string | undefined;
  invalid: boolean;
  onRetry: () => void;
}) {
  const { t } = useT('codeEditor');
  const noticeId = useId();
  return (
    <div className={cn('flex flex-col', fillHeight && 'h-full min-h-0')}>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={!editable}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={[describedBy, noticeId].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        rows={minRows}
        className={cn(
          'block w-full resize-y bg-transparent px-3 py-2 leading-[1.6] outline-none',
          font === 'prose' ? 'font-sans' : 'font-mono',
          fillHeight && 'min-h-0 flex-1',
        )}
        style={
          fillHeight
            ? undefined
            : { maxHeight: `calc(${maxRows} * 1.6em + 1rem)` }
        }
      />
      <div className="border-border text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs">
        <span id={noticeId}>{t('loadFailed')}</span>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}

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
