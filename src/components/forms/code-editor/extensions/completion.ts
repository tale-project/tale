import {
  acceptCompletion,
  autocompletion,
  insertCompletionText,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';

import type { CodeLanguage } from '../../../../lib/code-roles';
import { editorIcon, type EditorIconName } from '../icon-sprite';
import { cursorContext, type CursorContext } from '../member-path';
import type {
  CodeCompletionItem,
  CodeCompletionKind,
  CodeEditorProviders,
  CodeValueType,
} from '../providers';
import { highlightType } from './highlight';

/**
 * Completion from the host's provider: the editor works out where the
 * cursor is (the member chain, a JSON or YAML key) and asks; the host says
 * what can come next. A name that is not an identifier goes in as
 * `["a b"]`, a number as `[0]`. The list opens as the reader types a name,
 * a `.` or a `[` in code, a key in JSON or YAML, or on Ctrl-Space anywhere.
 */

export interface CompletionWords {
  type: string;
  optional: string;
  sample: (value: string) => string;
}

export interface CompletionConfig {
  language: CodeLanguage;
  providers: () => CodeEditorProviders | undefined;
  words: () => CompletionWords;
}

interface TaleCompletion extends Completion {
  item: CodeCompletionItem;
  /** The provider's order, kept among equally good matches. */
  order: number;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const INDEX = /^(?:0|[1-9]\d*)$/;

const KIND_ICON: Record<CodeCompletionKind, EditorIconName | null> = {
  node: 'workflow',
  input: 'log-in',
  method: 'square-function',
  function: 'square-function',
  keyword: 'key-round',
  constant: 'pi',
  snippet: 'code-xml',
  variable: null,
  property: null,
};

const VALUE_ICON: Record<CodeValueType, EditorIconName> = {
  string: 'type',
  number: 'hash',
  integer: 'hash',
  boolean: 'toggle-left',
  object: 'braces',
  array: 'brackets',
  null: 'ban',
  unknown: 'circle-dashed',
};

function iconFor(item: CodeCompletionItem): EditorIconName {
  const kind = item.kind === undefined ? null : KIND_ICON[item.kind];
  return kind ?? VALUE_ICON[item.valueType ?? 'unknown'];
}

function shorten(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** How a chosen name is written at the cursor. */
function applyFor(
  item: CodeCompletionItem,
  cursor: CursorContext,
): Completion['apply'] {
  if (item.apply !== undefined) return item.apply;
  const label = item.label;
  const plain = IDENTIFIER.test(label);
  if (cursor.trigger === 'bracket') {
    return INDEX.test(label) ? `${label}]` : `${JSON.stringify(label)}]`;
  }
  if (plain) return label;
  if (cursor.trigger !== 'dot') return label;
  const subscript = INDEX.test(label)
    ? `[${label}]`
    : `[${JSON.stringify(label)}]`;
  return (
    view: EditorView,
    _completion: Completion,
    from: number,
    to: number,
  ) => {
    // Replace the `.` (or keep `?.`) before the name with the subscript.
    const optional = view.state.doc.sliceString(from - 2, from) === '?.';
    const start = optional ? from : from - 1;
    view.dispatch(insertCompletionText(view.state, subscript, start, to));
  };
}

function infoFor(
  item: CodeCompletionItem,
  words: CompletionWords,
): Completion['info'] {
  const info = item.info;
  if (info === undefined && !item.optional) return undefined;
  return () => {
    const dom = document.createElement('div');
    dom.className = 'flex max-w-80 flex-col gap-1 p-2 text-xs';
    if (info?.type !== undefined) {
      const type = document.createElement('code');
      type.className = 'font-mono break-words whitespace-pre-wrap';
      type.setAttribute('aria-label', `${words.type}: ${info.type}`);
      for (const run of highlightType(info.type)) {
        const span = document.createElement('span');
        span.textContent = run.text;
        if (run.className !== '') span.className = run.className;
        type.appendChild(span);
      }
      dom.appendChild(type);
    }
    if (info?.description !== undefined) {
      const description = document.createElement('p');
      description.className = 'text-foreground';
      description.textContent = info.description;
      dom.appendChild(description);
    }
    if (info?.sample !== undefined) {
      const sample = document.createElement('p');
      sample.className = 'text-muted-foreground font-mono break-all';
      sample.textContent = words.sample(info.sample);
      dom.appendChild(sample);
    }
    if (item.optional) {
      const optional = document.createElement('p');
      optional.className = 'text-muted-foreground';
      optional.textContent = words.optional;
      dom.appendChild(optional);
    }
    return dom;
  };
}

function toCompletion(
  item: CodeCompletionItem,
  order: number,
  cursor: CursorContext,
  words: CompletionWords,
): TaleCompletion {
  return {
    item,
    order,
    label: item.label,
    ...(item.optional ? { displayLabel: `${item.label}?` } : {}),
    ...(item.detail !== undefined ? { detail: shorten(item.detail) } : {}),
    ...(item.section !== undefined ? { section: item.section } : {}),
    ...(item.boost !== undefined ? { boost: item.boost } : {}),
    type: item.kind ?? 'property',
    apply: applyFor(item, cursor),
    info: infoFor(item, words),
  };
}

/** Whether the cursor invites a list without Ctrl-Space. */
function opensByItself(cursor: CursorContext): boolean {
  if (cursor.region === 'code' || cursor.region === 'template') {
    return cursor.trigger !== 'none';
  }
  if (cursor.region === 'key') return cursor.word !== '';
  return false;
}

function completionSource(config: CompletionConfig) {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const provider = config.providers()?.completion;
    if (provider === undefined) return null;
    const cursor = cursorContext(context.state, context.pos);
    if (!context.explicit && !opensByItself(cursor)) return null;
    const controller = new AbortController();
    context.addEventListener('abort', () => controller.abort(), {
      onDocChange: true,
    });
    const answer = await provider({
      text: context.state.doc.toString(),
      pos: context.pos,
      language: config.language,
      region: cursor.region,
      path: cursor.path,
      prefix: cursor.word,
      from: cursor.from,
      to: cursor.to,
      ...(cursor.pointer !== undefined ? { pointer: cursor.pointer } : {}),
      explicit: context.explicit,
      signal: controller.signal,
    });
    if (answer === null || controller.signal.aborted) return null;
    const words = config.words();
    return {
      from: cursor.from,
      to: cursor.to,
      options: answer.items.map((item, order) =>
        toCompletion(item, order, cursor, words),
      ),
      validFor: answer.validFor ?? /^[\w$]*$/,
    };
  };
}

function isTaleCompletion(
  completion: Completion,
): completion is TaleCompletion {
  return 'item' in completion;
}

export function completionExtension(config: CompletionConfig): Extension {
  return [
    autocompletion({
      override: [completionSource(config)],
      activateOnTyping: true,
      selectOnOpen: true,
      closeOnBlur: true,
      maxRenderedOptions: 60,
      icons: false,
      // Equally good matches keep the host's order (earlier nodes first).
      compareCompletions: (a, b) =>
        isTaleCompletion(a) && isTaleCompletion(b)
          ? a.order - b.order
          : a.label.localeCompare(b.label),
      optionClass: () => 'pointer-coarse:min-h-9',
      tooltipClass: () =>
        'cm-tale-completion motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-[var(--duration-micro)] motion-safe:ease-[var(--ease-out-quint)]',
      addToOptions: [
        {
          position: 20,
          render: (option) =>
            isTaleCompletion(option)
              ? editorIcon(
                  iconFor(option.item),
                  'size-3.5 text-muted-foreground',
                )
              : null,
        },
      ],
    }),
    // Tab accepts while the list is open; otherwise it indents or moves on.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
  ];
}
