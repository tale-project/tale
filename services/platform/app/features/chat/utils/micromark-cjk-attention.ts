/**
 * micromark-cjk-attention — Fix emphasis flanking rules for CJK punctuation.
 *
 * CommonMark's flanking-delimiter rules classify characters into three groups:
 *   1 = whitespace, 2 = punctuation, undefined = other (letters, digits, etc.)
 *
 * A closing delimiter run (`**`) must be "right-flanking": either not preceded
 * by punctuation, or preceded by punctuation AND followed by whitespace/punctuation.
 * CJK full-width punctuation like `）` (U+FF09, category Pe) is classified as
 * punctuation, so `）**是` fails the right-flanking check — `**` can't close.
 *
 * Fix: for `*` markers, reclassify non-ASCII punctuation (codePoint > 0x7F) as
 * "other". This makes CJK punctuation transparent to flanking rules while
 * preserving ASCII punctuation behavior (which is well-tested and correct).
 *
 * Only applied to `*` (code 42), not `_` (code 95). Underscore emphasis has
 * additional rules (`_open = open && (before || !close)`) that produce wrong
 * results when non-ASCII punctuation is reclassified.
 */

import type {
  Code,
  Construct,
  Effects,
  State,
  TokenizeContext,
} from 'micromark-util-types';

import { attention } from 'micromark-core-commonmark';
import { classifyCharacter } from 'micromark-util-classify-character';

// oxlint-disable-next-line typescript/no-explicit-any -- remark plugin `this` context uses loose types
type PluginThis = { data: () => { micromarkExtensions?: any[] } };

// oxlint-disable-next-line typescript/no-non-null-assertion -- attention.resolveAll is always defined
const resolveAll = attention.resolveAll!;

const cjkAttention: Construct = {
  name: 'cjkAttention',
  resolveAll,
  tokenize: tokenizeCjkAttention,
};

function tokenizeCjkAttention(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
): State {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- always populated by defaults
  const attentionMarkers = this.parser.constructs.attentionMarkers.null!;
  const previous = this.previous;
  let marker: NonNullable<Code>;

  return function start(code: Code): State | undefined {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- called only when code matches marker
    marker = code!;
    effects.enter('attentionSequence');
    return inside(code);
  };

  function inside(code: Code): State | undefined {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }

    const token = effects.exit('attentionSequence');

    let before = classifyCharacter(previous);
    let after = classifyCharacter(code);

    // CJK fix: for * markers only, treat non-ASCII punctuation as "other"
    if (marker === 42) {
      if (before === 2 && previous !== null && previous > 0x7f) {
        before = undefined;
      }
      if (after === 2 && code !== null && code > 0x7f) {
        after = undefined;
      }
    }

    const codeNum = code ?? -1;
    const prevNum = previous ?? -1;
    const open =
      !after || (after === 2 && before) || attentionMarkers.includes(codeNum);
    const close =
      !before || (before === 2 && after) || attentionMarkers.includes(prevNum);
    token._open = Boolean(marker === 42 ? open : open && (before || !close));
    token._close = Boolean(marker === 42 ? close : close && (after || !open));
    return ok(code);
  }
}

/**
 * Micromark extension that replaces the built-in attention construct with
 * a CJK-aware version.
 */
export function micromarkCjkAttention() {
  return {
    disable: { null: ['attention'] },
    text: { 42: cjkAttention, 95: cjkAttention },
    insideSpan: { null: [cjkAttention] },
    attentionMarkers: { null: [42, 95] },
  };
}

/**
 * Remark plugin wrapper. Registers the micromark extension.
 *
 * Usage:
 *   const REMARK_PLUGINS = [remarkCjkAttention, remarkGfm];
 */
export function remarkCjkAttention(this: PluginThis) {
  const data = this.data();
  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  data.micromarkExtensions.push(micromarkCjkAttention());
}
