import { closeCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import {
  EditorState,
  Facet,
  Prec,
  Transaction,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from '@codemirror/view';

import { CLAIMS_ESCAPE_ATTRIBUTE } from '../../../overlays/claims-escape';

/**
 * The editor's keyboard model, so a code field never traps a keyboard user:
 *
 * - Tab indents in a multi-line editor; a one-line editor never takes Tab.
 * - Escape closes what is open (the completion list, a tooltip, the search
 *   panel); with nothing open it arms "leave" for two seconds and says so —
 *   Tab then moves focus out (CodeMirror's tab-focus window).
 * - Mod-Enter submits (and Enter, in a one-line editor).
 * - Ctrl-M (Shift-Alt-M on a Mac) toggles Tab between indenting and moving
 *   focus for good, and says which.
 *
 * Escape is claimed: while the editor needs it, its root carries
 * `data-claims-escape` (see `overlays/claims-escape.ts`). A dialog or sheet
 * hears Escape first — Radix listens on the document in the capture phase —
 * so the editor takes a claimed Escape earlier still, on the window, and
 * cancels it: the layer then stays open. The first Escape in a sheet closes
 * the completion list, the next arms leave, and the third (unclaimed) closes
 * the sheet.
 */

export interface KeyboardWords {
  leaveArmed: string;
  tabFocusOn: string;
  tabFocusOff: string;
}

export interface EscapeClosable {
  /** Closes the popup if one is open; true when it closed something. */
  close(view: EditorView): boolean;
  isOpen(view: EditorView): boolean;
}

/**
 * Popups the editor's other extensions open (the problem tooltip, the type
 * tooltip) register here so Escape closes them and the claim covers them.
 */
export const escapeClosables = Facet.define<EscapeClosable>();

const NO_WORDS: KeyboardWords = {
  leaveArmed: '',
  tabFocusOn: '',
  tabFocusOff: '',
};

/** The announcements, read at the moment they are made (the language may change). */
const keyboardWords = Facet.define<() => KeyboardWords, () => KeyboardWords>({
  combine: (values) => values[0] ?? (() => NO_WORDS),
});

const LEAVE_MS = 2000;

const builtInClosables: EscapeClosable[] = [
  {
    // A list on screen; a request still pending is dropped quietly below.
    isOpen: (view) => completionStatus(view.state) === 'active',
    close: (view) => closeCompletion(view),
  },
  {
    isOpen: (view) => searchPanelOpen(view.state),
    close: (view) => closeSearchPanel(view),
  },
];

function closables(view: EditorView): readonly EscapeClosable[] {
  return [...builtInClosables, ...view.state.facet(escapeClosables)];
}

class EscapeClaim implements PluginValue {
  armedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {
    listenForEscape();
    this.sync();
  }

  update(update: ViewUpdate) {
    if (update.focusChanged && !update.view.hasFocus) this.disarm();
    this.sync();
  }

  /** Closes what is open, else arms leave; the event is cancelled either way. */
  escape(event: KeyboardEvent) {
    const view = this.view;
    event.preventDefault();
    for (const closable of closables(view)) {
      if (closable.isOpen(view) && closable.close(view)) {
        this.sync();
        return;
      }
    }
    if (completionStatus(view.state) === 'pending') closeCompletion(view);
    view.setTabFocusMode(LEAVE_MS);
    this.arm();
    view.dispatch({
      effects: EditorView.announce.of(
        view.state.facet(keyboardWords)().leaveArmed,
      ),
    });
  }

  arm() {
    this.armedUntil = Date.now() + LEAVE_MS;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armedUntil = 0;
      this.sync();
    }, LEAVE_MS);
    this.sync();
  }

  disarm() {
    this.armedUntil = 0;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  get armed(): boolean {
    return this.armedUntil > Date.now();
  }

  /** The claim: a popup is open, or the editor has focus and is not leaving. */
  sync() {
    const open = closables(this.view).some((c) => c.isOpen(this.view));
    const claims = open || (this.view.hasFocus && !this.armed);
    if (claims) this.view.dom.setAttribute(CLAIMS_ESCAPE_ATTRIBUTE, '');
    else this.view.dom.removeAttribute(CLAIMS_ESCAPE_ATTRIBUTE);
  }

  destroy() {
    if (this.timer !== null) clearTimeout(this.timer);
  }
}

const escapeClaim = ViewPlugin.fromClass(EscapeClaim);

let escapeListener = false;

/**
 * One window listener for every editor on the page, in the capture phase so
 * it runs before any overlay's document listener: an Escape inside an editor
 * that claims it is the editor's.
 */
function listenForEscape(): void {
  if (escapeListener || typeof window === 'undefined') return;
  escapeListener = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        event.defaultPrevented
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const root = target.closest<HTMLElement>('.cm-editor');
      if (root === null || !root.hasAttribute(CLAIMS_ESCAPE_ATTRIBUTE)) return;
      const view = EditorView.findFromDOM(root);
      if (view === null || view.composing) return;
      view.plugin(escapeClaim)?.escape(event);
    },
    true,
  );
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function escapeHandling(words: () => KeyboardWords): Extension {
  return [
    keyboardWords.of(words),
    escapeClaim,
    EditorView.domEventObservers({
      keydown(event, view) {
        // Any other key ends the leave window, as CodeMirror's own does.
        if (
          event.key === 'Escape' ||
          event.key === 'Tab' ||
          MODIFIER_KEYS.has(event.key)
        ) {
          return;
        }
        const claim = view.plugin(escapeClaim);
        claim?.disarm();
        claim?.sync();
      },
      focus(_event, view) {
        view.plugin(escapeClaim)?.sync();
      },
      blur(_event, view) {
        const claim = view.plugin(escapeClaim);
        claim?.disarm();
        claim?.sync();
      },
    }),
  ];
}

/** Turns line breaks a one-line editor receives (a paste) into spaces. */
const singleLineFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      from: fromA,
      to: toA,
      // The document stores every line break as `\n`; a space keeps the
      // length, so the selection the transaction set still fits.
      insert: inserted.toString().replace(/\n/g, ' '),
    });
  });
  const spec: TransactionSpec = {
    changes,
    selection: tr.selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
  };
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent !== undefined) spec.userEvent = userEvent;
  return spec;
});

const permanentTabFocus = new WeakMap<EditorView, boolean>();

export interface KeyboardOptions {
  singleLine: boolean;
  /** Reads the current submit handler; null when the field has none. */
  submit: () => ((view: EditorView) => void) | null;
  words: () => KeyboardWords;
}

export function keyboard({
  singleLine,
  submit,
  words,
}: KeyboardOptions): Extension {
  const runSubmit = (view: EditorView): boolean => {
    const handler = submit();
    if (handler === null) return false;
    handler(view);
    return true;
  };
  const toggleTabFocus = (view: EditorView): boolean => {
    const next = !(permanentTabFocus.get(view) ?? false);
    permanentTabFocus.set(view, next);
    view.setTabFocusMode(next);
    view.dispatch({
      effects: EditorView.announce.of(
        next ? words().tabFocusOn : words().tabFocusOff,
      ),
    });
    return true;
  };
  return [
    escapeHandling(words),
    Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run: runSubmit },
        ...(singleLine
          ? [
              {
                key: 'Enter',
                run: (view: EditorView) => {
                  if (completionStatus(view.state) === 'active') return false;
                  runSubmit(view);
                  return true;
                },
              },
            ]
          : []),
        { key: 'Ctrl-m', mac: 'Shift-Alt-m', run: toggleTabFocus },
      ]),
    ),
    singleLine ? singleLineFilter : keymap.of([indentWithTab]),
  ];
}
