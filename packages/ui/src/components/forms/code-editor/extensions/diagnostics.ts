import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  Facet,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  hoverTooltip,
  keymap,
  showTooltip,
  ViewPlugin,
  type PluginValue,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { ReactNode } from 'react';

import type { CodeLanguage } from '../../../../lib/code-roles';
import { ISSUE_SEVERITY_ICON_CLASS } from '../../../feedback/issue-severity';
import { editorIcon } from '../icon-sprite';
import type { CodeEditorProviders } from '../providers';
import type { CodeEditorDiagnostic } from '../types';
import { escapeClosables } from './keyboard';
import { reactTooltip } from './tooltips';
import { walkTree } from './tree-walk';

/**
 * Problems in the text: the host's (a check's results, authoritative), a
 * host's local `lint` provider (instant), and the editor's own syntax marks
 * (JSON or YAML that does not parse, an unclosed `{{`, JavaScript that
 * cannot be read). All three live in one state field, mapped through every
 * edit; a problem whose text the reader edits hides until the next result.
 *
 * A problem shows as an underline whose style says its severity (wavy for
 * an error and a warning, dotted for a note), a glyph in the gutter, and a
 * tooltip on hover. F8 / Shift-F8 walk the problems and read each aloud;
 * Mod-. applies a fix.
 */

export type DiagnosticSource = 'host' | 'lint' | 'syntax';

export interface PlacedFix {
  label: string;
  changes: Array<{ from: number; to: number; insert: string }>;
}

/** A problem in document positions. `whole`: the field as a whole. */
export interface PlacedDiagnostic {
  key: string;
  source: DiagnosticSource;
  diagnostic: CodeEditorDiagnostic;
  from: number;
  to: number;
  whole: boolean;
  fixes: PlacedFix[];
}

export interface DiagnosticWords {
  severity: Record<CodeEditorDiagnostic['severity'], string>;
  atCursor: (values: {
    severity: string;
    line: number;
    message: string;
  }) => string;
  fixAvailable: (shortcut: string) => string;
  fixApplied: (label: string) => string;
  syntax: Record<
    'json' | 'yaml' | 'javascript' | 'unterminatedTemplate',
    string
  >;
}

export interface DiagnosticsConfig {
  language: CodeLanguage;
  words: () => DiagnosticWords;
  /** The tooltip body (React). `focusFix` focuses its first fix button. */
  render: (
    view: EditorView,
    items: readonly PlacedDiagnostic[],
    focusFix: boolean,
  ) => ReactNode;
  providers: () => CodeEditorProviders | undefined;
  syntax: boolean;
  gutter: boolean;
}

const SEVERITY_RANK: Record<CodeEditorDiagnostic['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/* --------------------------------------------------------------- placing */

/** One character at least: an empty range widens forward, or back at a line end. */
function widen(doc: Text, from: number, to: number): [number, number] {
  const start = Math.min(Math.max(from, 0), doc.length);
  const end = Math.min(Math.max(to, start), doc.length);
  if (end > start) return [start, end];
  if (start < doc.length && doc.sliceString(start, start + 1) !== '\n') {
    return [start, start + 1];
  }
  if (start > 0) return [start - 1, start];
  return [start, start];
}

/**
 * How text the host checked maps onto the text now shown: the common
 * prefix and suffix stay; a range inside what changed is gone.
 */
export function mapperFrom(
  checked: string | undefined,
  doc: Text,
): (from: number, to: number) => [number, number] | null {
  const now = doc.toString();
  if (checked === undefined || checked === now) return (from, to) => [from, to];
  const max = Math.min(checked.length, now.length);
  let prefix = 0;
  while (prefix < max && checked[prefix] === now[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    checked[checked.length - 1 - suffix] === now[now.length - 1 - suffix]
  ) {
    suffix++;
  }
  const changedEnd = checked.length - suffix;
  const delta = now.length - checked.length;
  // Text next to an edit counts as edited, as CodeMirror's own mapping
  // treats it: a problem on `a` is stale once `a` became `abc`.
  return (from, to) => {
    if (to < prefix) return [from, to];
    if (from > changedEnd) return [from + delta, to + delta];
    return null;
  };
}

export function placeDiagnostics(
  source: DiagnosticSource,
  diagnostics: readonly CodeEditorDiagnostic[],
  doc: Text,
  checked?: string,
): PlacedDiagnostic[] {
  const map = mapperFrom(checked, doc);
  const out: PlacedDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const fixes: PlacedFix[] = [];
    for (const fix of diagnostic.fixes ?? []) {
      const changes: PlacedFix['changes'] = [];
      let lost = false;
      for (const change of fix.changes) {
        const mapped = map(change.range[0], change.range[1]);
        if (mapped === null) lost = true;
        else
          changes.push({
            from: mapped[0],
            to: mapped[1],
            insert: change.insert,
          });
      }
      if (!lost) fixes.push({ label: fix.label, changes });
    }
    const key = `${source}:${diagnostic.id}`;
    if (diagnostic.range === undefined) {
      out.push({ key, source, diagnostic, from: 0, to: 0, whole: true, fixes });
      continue;
    }
    const mapped = map(diagnostic.range[0], diagnostic.range[1]);
    if (mapped === null) continue;
    const [from, to] = widen(doc, mapped[0], mapped[1]);
    out.push({ key, source, diagnostic, from, to, whole: false, fixes });
  }
  return out;
}

function overlaps(a: PlacedDiagnostic, b: PlacedDiagnostic): boolean {
  if (a.whole || b.whole) return false;
  return a.from < b.to && b.from < a.to;
}

/**
 * The problems to show: every host problem; a lint problem unless the host
 * reports the same code there; a syntax mark unless any other problem
 * covers its text.
 */
function merge(
  host: readonly PlacedDiagnostic[],
  lint: readonly PlacedDiagnostic[],
  syntax: readonly PlacedDiagnostic[],
): PlacedDiagnostic[] {
  const shown = [...host];
  for (const item of lint) {
    const duplicate = host.some(
      (known) =>
        known.diagnostic.code !== undefined &&
        known.diagnostic.code === item.diagnostic.code &&
        overlaps(known, item),
    );
    if (!duplicate) shown.push(item);
  }
  const reported = [...shown];
  for (const item of syntax) {
    if (!reported.some((known) => overlaps(known, item))) shown.push(item);
  }
  return shown.sort(
    (a, b) =>
      (a.whole ? -1 : a.from) - (b.whole ? -1 : b.from) ||
      SEVERITY_RANK[a.diagnostic.severity] -
        SEVERITY_RANK[b.diagnostic.severity],
  );
}

/* ----------------------------------------------------------------- state */

export const setDiagnostics = StateEffect.define<{
  source: DiagnosticSource;
  items: PlacedDiagnostic[];
}>();

/** The problem tooltip opened from the keyboard (F8, Mod-.). */
const pinTooltip = StateEffect.define<{
  keys: string[];
  pos: number;
  focusFix: boolean;
} | null>();

interface DiagnosticState {
  host: PlacedDiagnostic[];
  lint: PlacedDiagnostic[];
  syntax: PlacedDiagnostic[];
  shown: PlacedDiagnostic[];
  pinned: { keys: string[]; pos: number; focusFix: boolean } | null;
}

function mapThrough(
  items: readonly PlacedDiagnostic[],
  tr: Transaction,
): PlacedDiagnostic[] {
  if (!tr.docChanged) return [...items];
  const out: PlacedDiagnostic[] = [];
  for (const item of items) {
    if (item.whole) {
      out.push(item);
      continue;
    }
    if (tr.changes.touchesRange(item.from, item.to)) continue;
    const fixes = item.fixes.flatMap((fix) =>
      fix.changes.some((change) =>
        tr.changes.touchesRange(change.from, change.to),
      )
        ? []
        : [
            {
              label: fix.label,
              changes: fix.changes.map((change) => ({
                from: tr.changes.mapPos(change.from, 1),
                to: tr.changes.mapPos(change.to, -1),
                insert: change.insert,
              })),
            },
          ],
    );
    out.push({
      ...item,
      from: tr.changes.mapPos(item.from, 1),
      to: tr.changes.mapPos(item.to, -1),
      fixes,
    });
  }
  return out;
}

export const diagnosticState = StateField.define<DiagnosticState>({
  create: () => ({ host: [], lint: [], syntax: [], shown: [], pinned: null }),
  update(value, tr) {
    let { host, lint, syntax, pinned } = value;
    host = mapThrough(host, tr);
    lint = mapThrough(lint, tr);
    syntax = mapThrough(syntax, tr);
    if (tr.docChanged) pinned = null;
    for (const effect of tr.effects) {
      if (effect.is(setDiagnostics)) {
        if (effect.value.source === 'host') host = effect.value.items;
        else if (effect.value.source === 'lint') lint = effect.value.items;
        else syntax = effect.value.items;
      } else if (effect.is(pinTooltip)) {
        pinned = effect.value;
      }
    }
    return { host, lint, syntax, shown: merge(host, lint, syntax), pinned };
  },
});

/** The problems shown now (for tests and the summary). */
export function shownDiagnostics(
  state: EditorState,
): readonly PlacedDiagnostic[] {
  return state.field(diagnosticState, false)?.shown ?? [];
}

/* ---------------------------------------------------------- decorations */

const marks = {
  error: Decoration.mark({ class: 'cm-diagnostic cm-diagnostic-error' }),
  warning: Decoration.mark({ class: 'cm-diagnostic cm-diagnostic-warning' }),
  info: Decoration.mark({ class: 'cm-diagnostic cm-diagnostic-info' }),
};

const underlines = EditorView.decorations.compute(
  [diagnosticState],
  (state) => {
    const items = state
      .field(diagnosticState)
      .shown.filter((item) => !item.whole);
    return Decoration.set(
      items
        .filter((item) => item.to > item.from)
        .map((item) =>
          marks[item.diagnostic.severity].range(item.from, item.to),
        ),
      true,
    );
  },
);

const GUTTER_ICON = {
  error: 'circle-x',
  warning: 'triangle-alert',
  info: 'info',
} as const;

class SeverityMarker extends GutterMarker {
  constructor(readonly severity: CodeEditorDiagnostic['severity']) {
    super();
  }

  eq(other: SeverityMarker) {
    return other.severity === this.severity;
  }

  toDOM() {
    const icon = editorIcon(GUTTER_ICON[this.severity]);
    icon.classList.add(...ISSUE_SEVERITY_ICON_CLASS[this.severity].split(' '));
    return icon;
  }
}

const gutterMarkers = {
  error: new SeverityMarker('error'),
  warning: new SeverityMarker('warning'),
  info: new SeverityMarker('info'),
};

function lineMarkers(state: EditorState): RangeSet<GutterMarker> {
  const worst = new Map<number, CodeEditorDiagnostic['severity']>();
  for (const item of state.field(diagnosticState).shown) {
    const line = item.whole ? 1 : state.doc.lineAt(item.from).number;
    const known = worst.get(line);
    if (
      known === undefined ||
      SEVERITY_RANK[item.diagnostic.severity] < SEVERITY_RANK[known]
    ) {
      worst.set(line, item.diagnostic.severity);
    }
  }
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const line of [...worst.keys()].sort((a, b) => a - b)) {
    const severity = worst.get(line);
    if (severity === undefined) continue;
    const start = state.doc.line(line).from;
    builder.add(start, start, gutterMarkers[severity]);
  }
  return builder.finish();
}

const diagnosticGutter = gutter({
  class: 'cm-diagnostic-gutter',
  markers: (view) => lineMarkers(view.state),
  initialSpacer: () => gutterMarkers.info,
});

/* -------------------------------------------------------------- tooltips */

const diagnosticsConfig = Facet.define<
  DiagnosticsConfig,
  DiagnosticsConfig | null
>({
  combine: (values) => values[0] ?? null,
});

const TOOLTIP_CLASS =
  'cm-tale-tooltip motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[var(--duration-short)]';

function itemsAt(
  state: EditorState,
  pos: number,
  side: -1 | 1,
): PlacedDiagnostic[] {
  return state
    .field(diagnosticState)
    .shown.filter(
      (item) =>
        !item.whole &&
        item.from <= pos &&
        item.to >= pos &&
        (item.from < pos || side > 0) &&
        (item.to > pos || side < 0),
    );
}

function tooltipFor(
  items: readonly PlacedDiagnostic[],
  focusFix: boolean,
  pos?: number,
): Tooltip {
  const from = pos ?? Math.min(...items.map((item) => item.from));
  return {
    pos: from,
    end:
      pos === undefined ? Math.max(...items.map((item) => item.to)) : undefined,
    above: false,
    create: (view) => {
      const config = view.state.facet(diagnosticsConfig);
      return reactTooltip(
        view,
        config?.render(view, items, focusFix) ?? null,
        TOOLTIP_CLASS,
      );
    },
  };
}

const hoverProblems = hoverTooltip(
  (view, pos, side) => {
    const items = itemsAt(view.state, pos, side);
    return items.length === 0 ? null : tooltipFor(items, false);
  },
  { hoverTime: 200 },
);

const pinnedTooltip = showTooltip.compute([diagnosticState], (state) => {
  const pinned = state.field(diagnosticState).pinned;
  if (pinned === null) return null;
  const items = state
    .field(diagnosticState)
    .shown.filter((item) => pinned.keys.includes(item.key));
  if (items.length === 0) return null;
  return tooltipFor(items, pinned.focusFix, pinned.pos);
});

/* -------------------------------------------------------------- keyboard */

function announce(view: EditorView, text: string): void {
  view.dispatch({ effects: EditorView.announce.of(text) });
}

const FIX_SHORTCUT =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
    ? '⌘.'
    : 'Ctrl+.';

function describe(view: EditorView, item: PlacedDiagnostic): string {
  const config = view.state.facet(diagnosticsConfig);
  if (config === null) return item.diagnostic.message;
  const words = config.words();
  const line = item.whole ? 1 : view.state.doc.lineAt(item.from).number;
  const text = words.atCursor({
    severity: words.severity[item.diagnostic.severity],
    line,
    message: item.diagnostic.message,
  });
  return item.fixes.length > 0
    ? `${text} ${words.fixAvailable(FIX_SHORTCUT)}`
    : text;
}

/**
 * Moves to the next (or previous) problem after the cursor, selects it,
 * opens its tooltip and reads it aloud. Wraps around.
 */
export function goToDiagnostic(view: EditorView, direction: 1 | -1): boolean {
  const items = shownDiagnostics(view.state);
  if (items.length === 0) return false;
  // Forward from the end of the selection, back from its start: a problem
  // F8 selected is never found again.
  const { from: start, to: end } = view.state.selection.main;
  const placed = items.map((item) => ({
    item,
    at: item.whole ? 0 : item.from,
  }));
  const next =
    direction > 0
      ? (placed.find(({ at }) => at > end) ??
        placed.find(({ at }) => at >= end) ??
        placed[0])
      : (placed.findLast(({ at }) => at < start) ?? placed[placed.length - 1]);
  const { item } = next;
  const from = item.whole ? 0 : item.from;
  const to = item.whole ? 0 : item.to;
  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: [
      EditorView.scrollIntoView(from, { y: 'center' }),
      ...(item.whole
        ? []
        : [pinTooltip.of({ keys: [item.key], pos: from, focusFix: false })]),
    ],
    userEvent: 'select',
  });
  announce(view, describe(view, item));
  return true;
}

export function applyFix(view: EditorView, fix: PlacedFix): void {
  view.dispatch({
    changes: fix.changes,
    effects: pinTooltip.of(null),
    userEvent: 'input.fix',
  });
  view.focus();
  const config = view.state.facet(diagnosticsConfig);
  if (config !== null) announce(view, config.words().fixApplied(fix.label));
}

function quickFix(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const items = [
    ...itemsAt(view.state, head, -1),
    ...itemsAt(view.state, head, 1),
  ];
  const withFixes = items.filter((item) => item.fixes.length > 0);
  if (withFixes.length === 0) return false;
  const fixes = withFixes.flatMap((item) => item.fixes);
  if (fixes.length === 1) {
    applyFix(view, fixes[0]);
    return true;
  }
  view.dispatch({
    effects: pinTooltip.of({
      keys: withFixes.map((item) => item.key),
      pos: withFixes[0].from,
      focusFix: true,
    }),
  });
  return true;
}

/* ---------------------------------------------------------- syntax marks */

const SYNTAX_DELAY = 500;

function syntaxProblems(
  state: EditorState,
  language: CodeLanguage,
  words: DiagnosticWords,
): CodeEditorDiagnostic[] {
  const found: CodeEditorDiagnostic[] = [];
  const head = state.selection.main.head;
  const seen = new Set<number>();
  walkTree(syntaxTree(state), 0, state.doc.length, (node, offset) => {
    const isUnclosed = node.name === 'TemplateUnterminated';
    if (!node.type.isError && !isUnclosed) return;
    const [from, to] = widen(state.doc, offset + node.from, offset + node.to);
    if (seen.has(from)) return;
    seen.add(from);
    // Never under what the reader is still typing.
    if (from <= head && head <= to) return;
    const kind: keyof DiagnosticWords['syntax'] = isUnclosed
      ? 'unterminatedTemplate'
      : insideTemplate(node)
        ? 'javascript'
        : language === 'json' || language === 'yaml'
          ? language
          : 'javascript';
    found.push({
      id: `syntax-${from}`,
      severity: 'error',
      message: words.syntax[kind],
      range: [from, to],
    });
  });
  return found;
}

/** Inside a `{{ }}` template: the JavaScript of its body. */
function insideTemplate(node: SyntaxNode): boolean {
  for (let at: SyntaxNode | null = node; at !== null; at = at.parent) {
    if (at.name === 'TemplateBody' || at.name === 'Template') return true;
  }
  return false;
}

class SyntaxMarks implements PluginValue {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.schedule();
    }
  }

  schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const config = this.view.state.facet(diagnosticsConfig);
      if (config === null || !config.syntax) return;
      const problems = syntaxProblems(
        this.view.state,
        config.language,
        config.words(),
      );
      this.view.dispatch({
        effects: setDiagnostics.of({
          source: 'syntax',
          items: placeDiagnostics('syntax', problems, this.view.state.doc),
        }),
      });
    }, SYNTAX_DELAY);
  }

  destroy() {
    if (this.timer !== null) clearTimeout(this.timer);
  }
}

/* ------------------------------------------------------------ local lint */

class LocalLint implements PluginValue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: AbortController | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.schedule();
  }

  schedule() {
    const config = this.view.state.facet(diagnosticsConfig);
    const lint = config?.providers()?.lint;
    if (config === null || lint === undefined) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.running?.abort();
    const delay = config.providers()?.lintDelay ?? 150;
    this.timer = setTimeout(() => {
      this.timer = null;
      const controller = new AbortController();
      this.running = controller;
      const doc = this.view.state.doc;
      Promise.resolve(
        lint({
          text: doc.toString(),
          language: config.language,
          signal: controller.signal,
        }),
      ).then(
        (problems) => {
          if (controller.signal.aborted || this.view.state.doc !== doc) return;
          this.view.dispatch({
            effects: setDiagnostics.of({
              source: 'lint',
              items: placeDiagnostics('lint', problems, doc),
            }),
          });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('[code-editor] the lint provider failed', error);
        },
      );
    }, delay);
  }

  destroy() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.running?.abort();
  }
}

/* ------------------------------------------------------------- assembly */

export function diagnosticsExtension(config: DiagnosticsConfig): Extension {
  return [
    diagnosticsConfig.of(config),
    diagnosticState,
    underlines,
    hoverProblems,
    pinnedTooltip,
    config.gutter ? diagnosticGutter : [],
    ViewPlugin.fromClass(SyntaxMarks),
    ViewPlugin.fromClass(LocalLint),
    escapeClosables.of({
      isOpen: (view) => view.state.field(diagnosticState).pinned !== null,
      close: (view) => {
        view.dispatch({ effects: pinTooltip.of(null) });
        view.focus();
        return true;
      },
    }),
    keymap.of([
      { key: 'F8', run: (view) => goToDiagnostic(view, 1) },
      { key: 'Shift-F8', run: (view) => goToDiagnostic(view, -1) },
      { key: 'Mod-.', run: quickFix },
    ]),
  ];
}
