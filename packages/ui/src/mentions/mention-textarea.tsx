'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { Text } from '@tale/ui/text';
import { Textarea, type TextareaProps } from '@tale/ui/textarea';
import {
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  addMentionRanges,
  applyTextChange,
  type MentionDoc,
  type MentionDocOptions,
  mentionAfter,
  mentionBefore,
  mentionDisplayName,
  MentionHistory,
  type MentionRange,
  moveMentionRange,
  parseMentionDoc,
  serializeMentionDoc,
  settleMentionDoc,
  sliceMentionDoc,
  widenToMentions,
} from './mention-model';
import { filterMentionOptions, type MentionOption } from './mention-options';
import { detectMentionTrigger, type MentionTrigger } from './mention-trigger';
import { findMentions } from './scan-mentions';

/** The clipboard type a copy from a mention field carries beside its plain
 * text: the stored form of the copied part, so a paste keeps its mentions. */
export const MENTION_CLIPBOARD_TYPE = 'text/x-tale-mentions';

export interface MentionTextareaProps<Kind extends string> extends Omit<
  TextareaProps,
  'value' | 'defaultValue' | 'onChange' | 'overlay'
> {
  /** The text in its stored form, mention tokens included. */
  value: string;
  /** Called with the stored form after every edit. */
  onValueChange: (value: string) => void;
  /** The kinds of mention the text may hold. */
  kinds: readonly Kind[];
  /** Who can be mentioned. */
  options: readonly MentionOption<Kind>[];
  /** Which options a query finds; by name and keywords unless given. */
  filterOptions?: (
    options: readonly MentionOption<Kind>[],
    query: string,
  ) => MentionOption<Kind>[];
  /** The current name of whoever a token names. */
  nameOf?: MentionDocOptions<Kind>['nameOf'];
  /** Whom a typed `@handle` in text written before tokens names. */
  resolvePlain?: MentionDocOptions<Kind>['resolvePlain'];
  /** Called once the field is first focused: the moment to read the
   * options, which nobody needs before. */
  onOptionsWanted?: () => void;
  /** The picker's accessible name. */
  listboxLabel?: string;
  /** What the picker says when the query finds nobody. */
  emptyLabel?: string;
  /** Where the picker opens. A composer at the foot of a panel wants
   * 'above'; a field near the top of a dialog wants 'below'. */
  placement?: 'above' | 'below';
}

interface DocState<Kind extends string> {
  /** The stored value this doc was read from or written as. */
  value: string;
  doc: MentionDoc<Kind>;
  /** The value as it last came in from outside, and how the field writes
   * it back: an edit that returns to it hands back the value as it came. */
  origin: { value: string; written: string };
  /** The readers it was read with; new readers re-read an untouched doc. */
  nameOf: MentionTextareaProps<Kind>['nameOf'];
  resolvePlain: MentionTextareaProps<Kind>['resolvePlain'];
}

interface PendingInsert<Kind extends string> {
  at: number;
  ranges: readonly MentionRange<Kind>[];
}

/** What is left of a name a deletion bit into, in the text after it. */
interface Remnant {
  start: number;
  end: number;
  /** The words there, to tell whether they are still the remnant. */
  text: string;
  name: string;
}

/** Insert text the way typing does, so the field's own undo can take it
 * back. False where the browser will not (then the caller edits the value
 * itself). */
function insertNatively(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  // oxlint-disable-next-line typescript/no-deprecated -- the one way to change a textarea's text that stays on its native undo stack; `setRangeText` and a value write both clear it
  return document.execCommand('insertText', false, text);
}

function deleteNatively(): boolean {
  if (typeof document.execCommand !== 'function') return false;
  // oxlint-disable-next-line typescript/no-deprecated -- see insertNatively
  return document.execCommand('delete', false);
}

const DELETE_BACKWARD = new Set([
  'deleteContentBackward',
  'deleteWordBackward',
]);
const DELETE_FORWARD = new Set(['deleteContentForward', 'deleteWordForward']);

/** The textarea's text layout, copied onto the highlight layer. */
const MIRRORED: readonly (keyof CSSStyleDeclaration & string)[] = [
  'boxSizing',
  'direction',
  'fontFamily',
  'fontFeatureSettings',
  'fontKerning',
  'fontSize',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingTop',
  'tabSize',
  'textAlign',
  'textIndent',
  'textTransform',
  'wordBreak',
  'wordSpacing',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
];

/**
 * The highlights under a field's mentions: a layer laid exactly over the
 * textarea that repeats its text in transparent ink, with each mention on a
 * tinted ground. The textarea keeps its own text, caret, selection and
 * spellcheck; the layer only tints, and never takes the pointer.
 */
function MentionHighlights({
  textareaRef,
  doc,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  doc: MentionDoc;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (textarea === null || layer === null) return undefined;
    const measure = () => {
      const computed = getComputedStyle(textarea);
      const next: Record<string, string> = {};
      for (const property of MIRRORED) {
        const value = computed[property];
        if (typeof value === 'string') next[property] = value;
      }
      // A scrollbar narrows the textarea's text; the layer has none, so it
      // narrows its own by the same width.
      const borders =
        Number.parseFloat(computed.borderLeftWidth) +
        Number.parseFloat(computed.borderRightWidth);
      const scrollbar = Math.max(
        0,
        textarea.offsetWidth - textarea.clientWidth - borders,
      );
      next.paddingRight = `${Number.parseFloat(computed.paddingRight) + scrollbar}px`;
      setStyle(next);
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };
    const follow = () => {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    textarea.addEventListener('scroll', follow);
    return () => {
      observer.disconnect();
      textarea.removeEventListener('scroll', follow);
    };
  }, [textareaRef]);

  // New text can scroll the textarea without a scroll event of its own.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (textarea === null || layer === null) return;
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  });

  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of doc.ranges) {
    if (range.start > cursor) pieces.push(doc.text.slice(cursor, range.start));
    pieces.push(
      <mark
        key={range.start}
        data-mention-kind={range.kind}
        className="bg-primary/15 rounded-sm box-decoration-clone text-transparent"
      >
        {doc.text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  pieces.push(doc.text.slice(cursor));

  return (
    <div
      ref={layerRef}
      aria-hidden
      data-slot="mention-highlights"
      className="pointer-events-none absolute inset-0 overflow-hidden border-solid border-transparent break-words whitespace-pre-wrap text-transparent"
      style={style}
    >
      {pieces}
      {/* Keeps a trailing newline's empty last line, as the textarea does. */}
      {'​'}
    </div>
  );
}

/**
 * A textarea that mentions people: typing `@` opens a picker of the
 * `options`, and a picked mention reads `@` and the name, tinted. The value
 * a caller holds is the stored form, with each mention as a token
 * (`[@Ada Lovelace](mention:user/…)`), so it saves and restores as a plain
 * string; the field shows each token by its current name (`nameOf`).
 *
 * A mention is one piece: Backspace at its end or Delete at its start
 * removes all of it, a selection that cuts into one grows to take it whole,
 * and a cut or copy carries its mentions to a paste. Typing inside a name
 * makes it plain text. Undo brings a removed mention back. Each insert and
 * removal is announced.
 *
 * The native textarea stays: IME, spellcheck, autocorrect, selection and
 * screen readers work as in any field, and the picker follows the combobox
 * pattern (Up/Down move, Enter or Tab pick, Escape closes; a modified Enter
 * is the caller's).
 */
export function MentionTextarea<Kind extends string>({
  value,
  onValueChange,
  kinds,
  options,
  filterOptions = filterMentionOptions,
  nameOf,
  resolvePlain,
  onOptionsWanted,
  listboxLabel,
  emptyLabel,
  placement = 'above',
  onKeyDown,
  onKeyUp,
  onClick,
  onBlur,
  onFocus,
  onCopy,
  onCut,
  onPaste,
  id,
  disabled,
  ...textareaProps
}: MentionTextareaProps<Kind>) {
  const { t } = useT('mentions');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const read = useCallback(
    (stored: string) =>
      parseMentionDoc(stored, { kinds, nameOf, resolvePlain }),
    [kinds, nameOf, resolvePlain],
  );

  // The doc follows `value` when it changes from outside (a reset, a
  // restored draft) and the readers while nobody has typed yet: once
  // someone edits, the words on screen are theirs and never change under
  // the caret.
  const editedRef = useRef(false);
  const readState = (stored: string): DocState<Kind> => {
    const parsed = read(stored);
    return {
      value: stored,
      doc: parsed,
      origin: { value: stored, written: serializeMentionDoc(parsed) },
      nameOf,
      resolvePlain,
    };
  };
  const [state, setState] = useState<DocState<Kind>>(() => readState(value));
  let current = state;
  if (
    state.value !== value ||
    (!editedRef.current &&
      (state.nameOf !== nameOf || state.resolvePlain !== resolvePlain))
  ) {
    if (state.value !== value) editedRef.current = false;
    current = readState(value);
    setState(current);
  }
  const { doc } = current;
  const docRef = useRef(doc);
  docRef.current = doc;
  const originRef = useRef(current.origin);
  originRef.current = current.origin;

  const historyRef = useRef(new MentionHistory<Kind>());
  useEffect(() => {
    historyRef.current.record(doc);
  }, [doc]);

  const pendingRef = useRef<PendingInsert<Kind> | null>(null);
  const [repair, setRepair] = useState<Remnant[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    // The same words twice in a row must still be read out.
    setAnnouncement((previous) =>
      previous === message ? `${message} ` : message,
    );
  }, []);

  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [optionsWanted, setOptionsWanted] = useState(false);

  const results = useMemo(
    () => (trigger === null ? [] : filterOptions(options, trigger.query)),
    [filterOptions, options, trigger],
  );
  const clampedHighlight = Math.min(highlight, Math.max(results.length - 1, 0));
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const listboxId = `${textareaId}-mention-listbox`;
  const optionId = (index: number) => `${textareaId}-mention-option-${index}`;
  // A query that runs across a space is a name being typed only while it
  // still finds someone; otherwise the space ended the mention.
  const open =
    trigger !== null &&
    !disabled &&
    !(trigger.query.includes(' ') && results.length === 0);
  const listed = open && results.length > 0;

  /** Commit the field's new text: map the mentions onto it, place the ones
   * an insert brought, and let go of any that would not survive saving. */
  const commitText = useCallback(
    (next: string, caret: number, inputType: string) => {
      const before = docRef.current;
      let nextDoc: MentionDoc<Kind>;
      const remnants: Remnant[] = [];
      const recalled =
        inputType === 'historyUndo' || inputType === 'historyRedo'
          ? historyRef.current.recall(next)
          : null;
      if (recalled !== null) {
        nextDoc = recalled;
      } else {
        const change = applyTextChange(before, next, caret);
        nextDoc = change.doc;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) {
          nextDoc = addMentionRanges(
            nextDoc,
            pending.ranges.map((range) => moveMentionRange(range, pending.at)),
          );
        }
        // A deletion that bit into a name (a phone keyboard's Backspace
        // inside a word it was composing) takes the rest of the name too,
        // so half a name is never left to read as someone else's handle.
        if (change.nextEnd === change.from) {
          for (const range of change.cut) {
            const start = Math.min(range.start, change.from);
            const end =
              change.from + Math.max(0, range.end - change.previousEnd);
            if (end > start) {
              remnants.push({
                start,
                end,
                text: next.slice(start, end),
                name: range.name,
              });
            }
          }
        }
      }
      nextDoc = settleMentionDoc(nextDoc, kinds);
      editedRef.current = true;
      const written = serializeMentionDoc(nextDoc);
      // Back to what came in: the caller gets its own value, so a draft
      // compared with the saved text reads unchanged (the field may write an
      // older text's mentions differently: a typed handle as a token).
      const stored =
        written === originRef.current.written
          ? originRef.current.value
          : written;
      docRef.current = nextDoc;
      setState((previous) => ({ ...previous, value: stored, doc: nextDoc }));
      if (remnants.length > 0) setRepair(remnants);
      onValueChange(stored);
    },
    [kinds, onValueChange],
  );

  // The rest of a name a deletion bit into goes the way typing would, so
  // undo brings the whole name back. It waits for the next task: Chrome
  // runs no editing command while the input event that reported the
  // deletion is still being dispatched (it answers true and does nothing).
  useEffect(() => {
    if (repair.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setRepair([]);
      const textarea = textareaRef.current;
      if (textarea === null) return;
      for (const remnant of repair.toReversed()) {
        // Typed on since: the words there are someone's new text.
        const { start, end } = remnant;
        if (textarea.value.slice(start, end) !== remnant.text) continue;
        const before = textarea.value;
        textarea.setSelectionRange(start, end);
        if (!deleteNatively() || textarea.value === before) {
          textarea.setRangeText('', start, end, 'end');
          commitText(textarea.value, start, 'deleteContentBackward');
        }
        announce(t('removed', { name: remnant.name }));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [repair, commitText, announce, t]);

  /** Put text (and the mentions in it) where `start`..`end` stands, as
   * typing would. */
  const insertAt = useCallback(
    (start: number, end: number, inserted: MentionDoc<Kind>) => {
      const textarea = textareaRef.current;
      if (textarea === null) return;
      const span = widenToMentions(docRef.current, start, end);
      pendingRef.current = { at: span.start, ranges: inserted.ranges };
      textarea.focus();
      textarea.setSelectionRange(span.start, span.end);
      if (!insertNatively(inserted.text)) {
        textarea.setRangeText(inserted.text, span.start, span.end, 'end');
        commitText(textarea.value, textarea.selectionEnd, 'insertText');
      }
    },
    [commitText],
  );

  /** Re-read the `@` before the caret. `onlyWhenOpen` keeps caret moves
   * (clicks, arrows) from opening the picker: only typing opens it. */
  const updateTrigger = useCallback(
    (onlyWhenOpen: boolean) => {
      const textarea = textareaRef.current;
      if (textarea === null) return;
      const caret = textarea.selectionStart ?? textarea.value.length;
      let next = detectMentionTrigger(textarea.value, caret);
      if (next !== null) {
        const at = next.start;
        // Never inside a name already mentioned, nor where an `@` is no
        // mention: in code or math.
        const inName = docRef.current.ranges.some(
          (range) => range.start <= at && at < range.end,
        );
        const probe = `${textarea.value.slice(0, at)}@x ${textarea.value.slice(next.end)}`;
        const counts =
          !inName &&
          findMentions(probe, { kinds }).some(
            (occurrence) =>
              occurrence.type === 'plain' && occurrence.start === at,
          );
        if (!counts) next = null;
      }
      setTrigger((previous) => {
        if (onlyWhenOpen && previous === null) return previous;
        if (
          previous === null ||
          next === null ||
          previous.query !== next.query
        ) {
          setHighlight(0);
        }
        return next;
      });
    },
    [kinds],
  );

  const selectOption = useCallback(
    (option: MentionOption<Kind>) => {
      if (trigger === null) return;
      const name = mentionDisplayName(option.name, option.id);
      insertAt(trigger.start, trigger.end, {
        text: `@${name} `,
        ranges: [
          {
            kind: option.kind,
            id: option.id,
            name,
            start: 0,
            end: name.length + 1,
          },
        ],
      });
      setTrigger(null);
      setHighlight(0);
      announce(t('inserted', { name }));
    },
    [trigger, insertAt, announce, t],
  );

  // A mention is one piece: deletions and replacements that would take part
  // of one take all of it. React's `onBeforeInput` carries no input type,
  // so the native event is read.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return undefined;
    const onBeforeInputNative = (event: InputEvent) => {
      if (event.isComposing || !event.cancelable) return;
      const shown = docRef.current;
      if (shown.ranges.length === 0) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const type = event.inputType;
      let span: { start: number; end: number } | null = null;
      if (start === end) {
        let bitten: MentionRange<Kind> | null = null;
        if (DELETE_BACKWARD.has(type)) bitten = mentionBefore(shown, start);
        else if (DELETE_FORWARD.has(type)) bitten = mentionAfter(shown, start);
        else if (type === 'insertReplacementText') {
          // An autocorrect rewrites the word before the caret, or before the
          // space just typed: never a name's last word.
          const word = /\s/u.test(shown.text[start - 1] ?? '')
            ? start - 1
            : start;
          bitten = mentionBefore(shown, word) ?? mentionAfter(shown, word);
        }
        if (bitten !== null) span = bitten;
      } else {
        const widened = widenToMentions(shown, start, end);
        if (widened.start !== start || widened.end !== end) span = widened;
      }
      if (span === null) return;
      event.preventDefault();
      // A spelling correction never rewrites a name: it is left as it is.
      if (type === 'insertReplacementText') return;
      const removed = shown.ranges.filter(
        (range) => range.start >= span.start && range.end <= span.end,
      );
      textarea.setSelectionRange(span.start, span.end);
      if (type.startsWith('delete')) {
        if (!deleteNatively()) {
          textarea.setRangeText('', span.start, span.end, 'end');
          commitText(textarea.value, span.start, type);
        }
      } else {
        const text =
          event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
        if (!insertNatively(text)) {
          textarea.setRangeText(text, span.start, span.end, 'end');
          commitText(textarea.value, textarea.selectionEnd, type);
        }
      }
      for (const range of removed) announce(t('removed', { name: range.name }));
    };
    textarea.addEventListener('beforeinput', onBeforeInputNative);
    return () =>
      textarea.removeEventListener('beforeinput', onBeforeInputNative);
  }, [commitText, announce, t]);

  // Keep the highlighted option in view while moving with the keyboard.
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [clampedHighlight]);

  const handleChange = (event: FormEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const native = event.nativeEvent;
    const inputType =
      native instanceof InputEvent ? native.inputType : 'insertText';
    commitText(textarea.value, textarea.selectionEnd, inputType);
    updateTrigger(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME commit (Enter or an arrow during composition) never drives the
    // picker; `keyCode` 229 is Safari's composition key.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (open && !composing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTrigger(null);
        return;
      }
      if (results.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setHighlight((index) => Math.min(index + 1, results.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setHighlight((index) => Math.max(index - 1, 0));
          return;
        }
        // Bare Enter or Tab picks; a modified Enter is the caller's (a
        // composer sends on ⌘/Ctrl+Enter).
        const picked = results[clampedHighlight];
        if (
          picked !== undefined &&
          ((event.key === 'Enter' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey) ||
            event.key === 'Tab')
        ) {
          event.preventDefault();
          selectOption(picked);
          return;
        }
      }
    }
    onKeyDown?.(event);
  };

  /** A copy or cut that holds mentions carries their stored form. */
  const handleCopy = (
    event: ClipboardEvent<HTMLTextAreaElement>,
    cut: boolean,
  ) => {
    const textarea = event.currentTarget;
    const selected = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    if (selected.start === selected.end) return;
    const { start, end } = cut
      ? widenToMentions(docRef.current, selected.start, selected.end)
      : selected;
    const slice = sliceMentionDoc(docRef.current, start, end);
    const widened = start !== selected.start || end !== selected.end;
    // Plain words copy and cut the way they always do.
    if (slice.ranges.length === 0 && !widened) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', slice.text);
    if (slice.ranges.length > 0) {
      event.clipboardData.setData(
        MENTION_CLIPBOARD_TYPE,
        serializeMentionDoc(slice),
      );
    }
    if (cut) {
      textarea.setSelectionRange(start, end);
      if (!deleteNatively()) {
        textarea.setRangeText('', start, end, 'end');
        commitText(textarea.value, start, 'deleteByCut');
      }
    }
  };

  /** A paste of mentions, from this or another mention field or as tokens
   * in plain text (an API answer), keeps them as mentions. */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const stored =
      event.clipboardData.getData(MENTION_CLIPBOARD_TYPE) ||
      event.clipboardData.getData('text/plain');
    if (!stored.includes('](mention:')) return;
    const pasted = parseMentionDoc(stored, { kinds, nameOf });
    if (pasted.ranges.length === 0) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    insertAt(textarea.selectionStart, textarea.selectionEnd, pasted);
  };

  return (
    <div className="relative">
      <Textarea
        {...textareaProps}
        id={textareaId}
        ref={textareaRef}
        disabled={disabled}
        value={doc.text}
        // Always drawn, even with nothing to tint: a layer that came and
        // went would rebuild the field around the textarea, and it would
        // lose its focus and its undo.
        overlay={<MentionHighlights textareaRef={textareaRef} doc={doc} />}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          updateTrigger(true);
          onKeyUp?.(event);
        }}
        onClick={(event) => {
          updateTrigger(true);
          onClick?.(event);
        }}
        onBlur={(event) => {
          setTrigger(null);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          if (!optionsWanted) {
            setOptionsWanted(true);
            onOptionsWanted?.();
          }
          onFocus?.(event);
        }}
        onCopy={(event) => {
          onCopy?.(event);
          if (!event.defaultPrevented) handleCopy(event, false);
        }}
        onCut={(event) => {
          onCut?.(event);
          if (!event.defaultPrevented) handleCopy(event, true);
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (!event.defaultPrevented) handlePaste(event);
        }}
        aria-autocomplete="list"
        aria-controls={listed ? listboxId : undefined}
        aria-activedescendant={listed ? optionId(clampedHighlight) : undefined}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {open && (
        <div
          className={cn(
            'border-border bg-popover text-popover-foreground absolute right-0 left-0 z-50 overflow-hidden rounded-xl border shadow-lg',
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {results.length === 0 ? (
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground px-3 py-2.5"
            >
              {emptyLabel ?? t('empty')}
            </Text>
          ) : (
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={listboxLabel ?? t('listboxLabel')}
              className="max-h-56 overflow-y-auto py-1"
            >
              {results.map((option, index) => {
                const active = index === clampedHighlight;
                return (
                  <div
                    key={`${option.kind}:${option.id}`}
                    id={optionId(index)}
                    role="option"
                    // The keyboard stays in the field and moves through the
                    // options by aria-activedescendant.
                    tabIndex={-1}
                    aria-selected={active}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
                      active && 'bg-accent text-accent-foreground',
                    )}
                    // Picks on mousedown, before the field would blur and
                    // close the picker.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectOption(option);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    {option.avatar}
                    <span className="min-w-0 flex-1">
                      <Text
                        as="span"
                        variant="label"
                        className="block truncate"
                      >
                        {option.name}
                      </Text>
                      {option.caption !== undefined && (
                        <Text
                          as="span"
                          variant="caption"
                          className="text-muted-foreground block truncate"
                        >
                          {option.caption}
                        </Text>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
