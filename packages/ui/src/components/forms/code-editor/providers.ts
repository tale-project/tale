/**
 * What a host plugs into the code editor: completion, hover and local
 * problems. Each provider is a plain function over a parsed context, with no
 * editor types in it, so a host's knowledge (the shapes of an automation's
 * data, later a TypeScript worker) stays out of the editor and any number of
 * hosts can be combined.
 */

import type { CodeLanguage } from '../../../lib/code-roles';
import type { CodeEditorDiagnostic } from './types';

export type { CodeLanguage } from '../../../lib/code-roles';

/**
 * What the cursor sits in: JavaScript `code`, the JavaScript inside a
 * `{{ }}` `template`, plain `text` (prose, Markdown), a JSON/YAML `string`
 * value or `key`, or a `comment`.
 */
export type CodeRegion =
  | 'code'
  | 'template'
  | 'text'
  | 'string'
  | 'key'
  | 'comment';

export type CodePathSegment = string | number;

export interface CodeCompletionContext {
  text: string;
  pos: number;
  language: CodeLanguage;
  region: CodeRegion;
  /**
   * The member chain left of the cursor, in JavaScript (a script, an
   * expression or a template's body): `nodes.score.output.it|` →
   * `['nodes', 'score', 'output']` with prefix `it`; `nodes["a b"]?.x.` →
   * `['nodes', 'a b', 'x']`; `items[0].` → `[…, 'items', 0]`; a bare
   * identifier → `[]`; outside an expression → `null`.
   */
  path: readonly CodePathSegment[] | null;
  /** The word being typed, `[from, to)`. */
  prefix: string;
  from: number;
  to: number;
  /** JSON/YAML: pointer of the object whose key or value holds the cursor. */
  pointer?: string;
  /** Asked for (Ctrl+Space) rather than opened by typing. */
  explicit: boolean;
  /** Aborted when the reader types on and the answer is no longer wanted. */
  signal: AbortSignal;
}

export type CodeCompletionKind =
  | 'node'
  | 'input'
  | 'variable'
  | 'property'
  | 'method'
  | 'function'
  | 'keyword'
  | 'constant'
  | 'snippet';

export type CodeValueType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'unknown';

export interface CodeCompletionItem {
  /** The name. One that is not an identifier is inserted as `["name"]`. */
  label: string;
  /** Raw text to insert instead of the label (a snippet). */
  apply?: string;
  /** Short trailing text: `string`, `Transform`, `{ count: number }`. */
  detail?: string;
  kind?: CodeCompletionKind;
  /** Picks the icon of a variable or property. */
  valueType?: CodeValueType;
  info?: { type?: string; description?: string; sample?: string };
  /** Shows `?` after the label and "optional" in the info panel. */
  optional?: boolean;
  /** Group header: "Earlier nodes". */
  section?: string;
  boost?: number;
}

export type CodeCompletionResult = {
  items: readonly CodeCompletionItem[];
  /** Keep the answer while the typed word still matches. */
  validFor?: RegExp;
} | null;

export interface CodeHoverContext {
  text: string;
  pos: number;
  language: CodeLanguage;
  region: CodeRegion;
  /** The chain up to and including the hovered word. */
  path: readonly CodePathSegment[] | null;
  word: string;
  from: number;
  to: number;
  signal: AbortSignal;
}

export interface CodeHoverInfo {
  /** TypeScript-like, highlighted. */
  type: string;
  /** `nodes.score.output.total`. */
  title?: string;
  description?: string;
  /** Last run's value, already redacted and shortened by the host. */
  sample?: string;
}

export interface CodeLintContext {
  text: string;
  language: CodeLanguage;
  signal: AbortSignal;
}

export interface CodeEditorProviders {
  completion?: (
    context: CodeCompletionContext,
  ) => CodeCompletionResult | Promise<CodeCompletionResult>;
  hover?: (
    context: CodeHoverContext,
  ) => CodeHoverInfo | null | Promise<CodeHoverInfo | null>;
  /** Instant local problems (a host's own checker), debounced by `lintDelay`. */
  lint?: (
    context: CodeLintContext,
  ) =>
    | readonly CodeEditorDiagnostic[]
    | Promise<readonly CodeEditorDiagnostic[]>;
  /** Milliseconds after the last edit before `lint` runs; default 150. */
  lintDelay?: number;
}

function sameRange(
  a: CodeEditorDiagnostic['range'],
  b: CodeEditorDiagnostic['range'],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Merges providers (say, an automation's data shapes and a TypeScript
 * worker): completions are concatenated with one item per label, the higher
 * `boost` winning; the first hover answer wins; problems are concatenated
 * with one per `code` and range.
 */
export function combineProviders(
  ...providers: Array<CodeEditorProviders | undefined>
): CodeEditorProviders {
  const present = providers.filter(
    (provider): provider is CodeEditorProviders => provider !== undefined,
  );
  const completers = present.flatMap((p) =>
    p.completion ? [p.completion] : [],
  );
  const hovers = present.flatMap((p) => (p.hover ? [p.hover] : []));
  const linters = present.flatMap((p) => (p.lint ? [p.lint] : []));
  const combined: CodeEditorProviders = {};
  if (completers.length > 0) {
    combined.completion = async (context) => {
      const answers = await Promise.all(
        completers.map((c) => Promise.resolve(c(context))),
      );
      const byLabel = new Map<string, CodeCompletionItem>();
      let validFor: RegExp | undefined;
      let any = false;
      for (const answer of answers) {
        if (answer === null) continue;
        any = true;
        validFor ??= answer.validFor;
        for (const item of answer.items) {
          const known = byLabel.get(item.label);
          if (known === undefined || (item.boost ?? 0) > (known.boost ?? 0)) {
            byLabel.set(item.label, item);
          }
        }
      }
      if (!any) return null;
      return { items: [...byLabel.values()], validFor };
    };
  }
  if (hovers.length > 0) {
    combined.hover = async (context) => {
      for (const hover of hovers) {
        const answer = await hover(context);
        if (answer !== null) return answer;
      }
      return null;
    };
  }
  if (linters.length > 0) {
    combined.lint = async (context) => {
      const answers = await Promise.all(
        linters.map((lint) => Promise.resolve(lint(context))),
      );
      const out: CodeEditorDiagnostic[] = [];
      for (const diagnostic of answers.flat()) {
        const duplicate = out.some(
          (known) =>
            known.code !== undefined &&
            known.code === diagnostic.code &&
            sameRange(known.range, diagnostic.range),
        );
        if (!duplicate) out.push(diagnostic);
      }
      return out;
    };
    const delays = present.flatMap((p) =>
      p.lint && p.lintDelay !== undefined ? [p.lintDelay] : [],
    );
    if (delays.length > 0) combined.lintDelay = Math.min(...delays);
  }
  return combined;
}
