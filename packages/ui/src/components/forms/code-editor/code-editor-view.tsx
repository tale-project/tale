'use client';

/**
 * The CodeMirror implementation behind `CodeEditor` — loaded lazily, the
 * first time a code field mounts (or `preloadCodeEditor()` asks). Nothing
 * outside this module and its `extensions/` imports CodeMirror, so a page
 * without a code field never downloads it.
 */

import {
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { useT } from '../../../i18n/client';
import type { IssueFocusPart, IssueFocusRange } from '../issue-focus';
import { codeHighlighting } from './extensions/highlight';
import { keyboard, type KeyboardWords } from './extensions/keyboard';
import { languageExtension, templatesOn } from './extensions/languages';
import { memberObjects } from './extensions/member-objects';
import { editorPhrases } from './extensions/phrases';
import { templateChips } from './extensions/template/chips';
import { templateInput } from './extensions/template/input';
import { codeEditorTheme } from './extensions/theme';
import { editorIcon, EditorIconSprite } from './icon-sprite';
import { locateJsonPointer, locateYamlPointer } from './locate';
import type { CodeEditorProps } from './types';

/** What the light wrapper drives once the view exists. */
export interface CodeEditorViewHandle {
  view: EditorView;
  /**
   * Focuses and selects `range` (offsets into the text), or the `part` of a
   * JSON or YAML value a problem names (`/to` inside the field's value).
   */
  focus(range?: IssueFocusRange, part?: IssueFocusPart): void;
  getSelection(): readonly [number, number] | null;
  openCompletion(): void;
  nextDiagnostic(direction: 1 | -1): void;
}

export interface CodeEditorViewProps extends CodeEditorProps {
  /** The ids the editor's content is described by, merged by the wrapper. */
  describedBy: string | undefined;
  reducedMotion: boolean;
  onView: (handle: CodeEditorViewHandle | null) => void;
}

/** Marks a transaction that applies the `value` prop (not the reader typing). */
const external = Annotation.define<boolean>();

/** The smallest change that turns `from` into `to`: common prefix and suffix kept. */
function minimalChange(
  from: string,
  to: string,
): { from: number; to: number; insert: string } {
  const max = Math.min(from.length, to.length);
  let start = 0;
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start))
    start++;
  let end = 0;
  while (
    end < max - start &&
    from.charCodeAt(from.length - 1 - end) ===
      to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return {
    from: start,
    to: from.length - end,
    insert: to.slice(start, to.length - end),
  };
}

function clampRange(
  state: EditorState,
  range: readonly [number, number],
): [number, number] {
  const length = state.doc.length;
  const from = Math.min(Math.max(range[0], 0), length);
  const to = Math.min(Math.max(range[1], from), length);
  return [from, to];
}

const CODE_LANGUAGES = new Set(['javascript', 'expression', 'json', 'yaml']);

/** A stable number per template scanner, for the language signature. */
const scannerIds = new WeakMap<object, number>();
let scannerCount = 0;
function scannerId(scanner: unknown): number {
  if (typeof scanner !== 'function') return 0;
  const known = scannerIds.get(scanner);
  if (known !== undefined) return known;
  scannerCount += 1;
  scannerIds.set(scanner, scannerCount);
  return scannerCount;
}

type SlotName =
  | 'language'
  | 'editable'
  | 'gutters'
  | 'wrap'
  | 'placeholder'
  | 'attributes'
  | 'keyboard'
  | 'search'
  | 'templates'
  | 'phrases'
  | 'selection';

const SLOT_NAMES: readonly SlotName[] = [
  'language',
  'editable',
  'gutters',
  'wrap',
  'placeholder',
  'attributes',
  'keyboard',
  'search',
  'templates',
  'phrases',
  'selection',
];

/** One reconfigurable part: rebuilt only when its signature changes. */
interface Slot {
  signature: string;
  build: () => Extension;
}

export default function CodeEditorView(props: CodeEditorViewProps) {
  const { t } = useT('codeEditor');
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  const pendingValue = useRef<string | null>(null);
  const compartments = useRef<Record<SlotName, Compartment> | null>(null);
  compartments.current ??= {
    language: new Compartment(),
    editable: new Compartment(),
    gutters: new Compartment(),
    wrap: new Compartment(),
    placeholder: new Compartment(),
    attributes: new Compartment(),
    keyboard: new Compartment(),
    search: new Compartment(),
    templates: new Compartment(),
    phrases: new Compartment(),
    selection: new Compartment(),
  };
  const applied = useRef<Partial<Record<SlotName, string>>>({});

  useLayoutEffect(() => {
    latest.current = props;
  });

  const words: KeyboardWords = {
    leaveArmed: t('leaveArmed'),
    tabFocusOn: t('tabFocusOn'),
    tabFocusOff: t('tabFocusOff'),
  };
  const wordsRef = useRef(words);
  useLayoutEffect(() => {
    wordsRef.current = words;
  });

  const {
    language,
    templates = false,
    templateScanner,
    readOnly = false,
    disabled = false,
    disabledReason,
    placeholder,
    singleLine = false,
    lineNumbers: showLineNumbers = false,
    fold = showLineNumbers,
    search: withSearch = false,
    wrap,
    font = 'mono',
    fillHeight = false,
    id,
    required,
    describedBy,
    reducedMotion,
  } = props;
  const softDisabled = disabled && hasReason(disabledReason);
  const editable = !disabled && !readOnly;
  const live = templatesOn(language, templates);
  const isCode = CODE_LANGUAGES.has(language);
  const wraps = wrap ?? (singleLine || !isCode);

  const contentAttributes: Record<string, string> = {
    ...(id !== undefined ? { id } : {}),
    ...(props['aria-label'] !== undefined
      ? { 'aria-label': props['aria-label'] }
      : {}),
    ...(props['aria-labelledby'] !== undefined
      ? { 'aria-labelledby': props['aria-labelledby'] }
      : {}),
    ...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {}),
    ...(props['aria-invalid'] ? { 'aria-invalid': 'true' } : {}),
    ...(required ? { 'aria-required': 'true' } : {}),
    ...(readOnly ? { 'aria-readonly': 'true', inputmode: 'none' } : {}),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(softDisabled || (readOnly && !disabled) ? { tabindex: '0' } : {}),
    'aria-multiline': singleLine ? 'false' : 'true',
    'aria-roledescription': t('roleDescription'),
    spellcheck: font === 'prose' ? 'true' : 'false',
    autocorrect: font === 'prose' ? 'on' : 'off',
    autocapitalize: 'off',
    ...(isCode ? { translate: 'no', dir: 'ltr' } : {}),
  };
  const rootClass = [
    font === 'prose' ? 'cm-prose' : '',
    fillHeight ? 'cm-fill' : '',
    readOnly || disabled ? 'cm-readonly' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const phrases = editorPhrases(t);

  const slots: Record<SlotName, Slot> = {
    language: {
      signature: `${language}|${templates}|${scannerId(templateScanner)}`,
      build: () => languageExtension(language, templates, templateScanner),
    },
    editable: {
      signature: `${readOnly}|${disabled}`,
      build: () => [
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(!disabled),
      ],
    },
    gutters: {
      signature: `${showLineNumbers}|${fold}`,
      build: () => [
        showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
        fold
          ? [
              codeFolding(),
              foldGutter({
                markerDOM: (open) =>
                  editorIcon(open ? 'chevron-down' : 'chevron-right'),
              }),
              keymap.of(foldKeymap),
            ]
          : [],
      ],
    },
    wrap: {
      signature: String(wraps),
      build: () => (wraps ? EditorView.lineWrapping : []),
    },
    placeholder: {
      signature: placeholder ?? '',
      build: () =>
        placeholder !== undefined && placeholder !== ''
          ? placeholderExtension(placeholder)
          : [],
    },
    attributes: {
      signature: JSON.stringify([contentAttributes, rootClass]),
      build: () => [
        EditorView.contentAttributes.of(contentAttributes),
        EditorView.editorAttributes.of({ class: rootClass }),
      ],
    },
    keyboard: {
      signature: String(singleLine),
      build: () =>
        keyboard({
          singleLine,
          words: () => wordsRef.current,
          submit: () => {
            const onSubmit = latest.current.onSubmit;
            if (onSubmit === undefined) return null;
            return (view) => onSubmit(view.state.doc.toString());
          },
        }),
    },
    search: {
      signature: String(withSearch),
      build: () =>
        withSearch
          ? [
              search({ top: true }),
              highlightSelectionMatches(),
              keymap.of(searchKeymap),
            ]
          : [],
    },
    templates: {
      signature: `${live}|${language}`,
      // The chip is the outer element, so a coloured name inside it never
      // splits it into pieces.
      build: () =>
        live ? [Prec.lowest(templateChips), templateInput(language)] : [],
    },
    phrases: {
      signature: JSON.stringify(phrases),
      build: () => EditorState.phrases.of(phrases),
    },
    selection: {
      signature: String(reducedMotion),
      build: () => drawSelection({ cursorBlinkRate: reducedMotion ? 0 : 1200 }),
    },
  };
  const slotsRef = useRef(slots);
  useLayoutEffect(() => {
    slotsRef.current = slots;
  });

  // Create the view once; props flow in through the compartments.
  useLayoutEffect(() => {
    const parent = host.current;
    const c = compartments.current;
    if (parent === null || c === null) return undefined;
    const initial = latest.current;
    const doc = initial.value;
    const selection =
      initial.initialSelection === undefined
        ? undefined
        : EditorSelection.single(
            ...clampRange(
              EditorState.create({ doc }),
              initial.initialSelection,
            ),
          );
    const startSlots = slotsRef.current;
    const slotExtensions = SLOT_NAMES.map((name) => {
      applied.current[name] = startSlots[name].signature;
      return c[name].of(startSlots[name].build());
    });
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        ...(selection !== undefined ? { selection } : {}),
        extensions: [
          slotExtensions,
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          history(),
          highlightSpecialChars(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          memberObjects,
          codeHighlighting,
          codeEditorTheme,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            const changed = update.transactions.some(
              (tr) => tr.docChanged && tr.annotation(external) !== true,
            );
            if (changed) latest.current.onChange?.(update.state.doc.toString());
            if (update.focusChanged) {
              if (update.view.hasFocus) latest.current.onFocus?.();
              else latest.current.onBlur?.();
            }
          }),
          EditorView.domEventObservers({
            compositionend: () => {
              // CodeMirror finishes the composition after this event; apply
              // a value the host sent meanwhile once it has.
              setTimeout(() => {
                const pending = pendingValue.current;
                const current = viewRef.current;
                if (
                  pending === null ||
                  current === null ||
                  current.compositionStarted
                ) {
                  return;
                }
                pendingValue.current = null;
                applyValue(current, pending);
              }, 0);
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    latest.current.onView({
      view,
      focus(range, part) {
        view.focus();
        const target = range ?? locatePart(view, latest.current.language, part);
        if (target === undefined) return;
        const [from, to] = clampRange(view.state, target);
        view.dispatch({
          selection: EditorSelection.single(from, to),
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
          userEvent: 'select',
        });
      },
      getSelection() {
        const main = view.state.selection.main;
        return [main.from, main.to];
      },
      openCompletion() {
        view.focus();
        startCompletion(view);
      },
      nextDiagnostic() {
        view.focus();
      },
    });
    return () => {
      latest.current.onView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure the parts whose props changed.
  useEffect(() => {
    const view = viewRef.current;
    const c = compartments.current;
    if (view === null || c === null) return;
    const effects = SLOT_NAMES.filter(
      (name) => applied.current[name] !== slots[name].signature,
    ).map((name) => {
      applied.current[name] = slots[name].signature;
      return c[name].reconfigure(slots[name].build());
    });
    if (effects.length > 0) view.dispatch({ effects });
  });

  // The value prop: applied as the smallest change, never echoed.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    // Mid-composition (IME), a change would break the reader's input.
    if (view.compositionStarted) {
      pendingValue.current = props.value;
      return;
    }
    applyValue(view, props.value);
  }, [props.value]);

  return (
    <>
      <EditorIconSprite />
      <div
        ref={host}
        className={fillHeight ? 'h-full min-h-0' : undefined}
        data-code-editor-view=""
      />
    </>
  );
}

/** Where the part of a JSON or YAML value a request names sits in the text. */
function locatePart(
  view: EditorView,
  language: CodeEditorProps['language'],
  part: IssueFocusPart | undefined,
): IssueFocusRange | undefined {
  if (part === undefined) return undefined;
  const text = view.state.doc.toString();
  const options = part.range === undefined ? {} : { range: part.range };
  const found =
    language === 'json'
      ? locateJsonPointer(text, part.rest, options)
      : language === 'yaml'
        ? locateYamlPointer(text, part.rest, options)
        : null;
  return found === null ? undefined : [found.from, found.to];
}

function hasReason(reason: unknown): boolean {
  if (reason === undefined || reason === null || typeof reason === 'boolean') {
    return false;
  }
  return typeof reason !== 'string' || reason.trim() !== '';
}

function applyValue(view: EditorView, value: string): void {
  const current = view.state.doc.toString();
  if (current === value) return;
  view.dispatch({
    changes: minimalChange(current, value),
    annotations: [external.of(true), Transaction.addToHistory.of(false)],
  });
}
