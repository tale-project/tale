/**
 * The remark plugin lists Tale parses markdown with, kept apart from the
 * React renderers so code that only reads markdown — the platform's backend,
 * which runs unbundled and never loads a `.tsx` module — parses a text
 * exactly as the screen does.
 */

import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';

import { remarkCjkAttention } from './plugins/micromark-cjk-attention';

/**
 * Indented code (four leading spaces) is plain text here: model output and
 * pasted prose indent paragraphs far more often than anyone means a code
 * block, and fenced code stays code.
 */
function remarkDisableIndentedCode(this: {
  data: () => { micromarkExtensions?: { disable?: { null?: string[] } }[] };
}) {
  const data = this.data();
  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  data.micromarkExtensions.push({ disable: { null: ['codeIndented'] } });
}

// Cast through `as PluggableList` because `remarkCjkAttention` and
// `remarkDisableIndentedCode` use narrowed `this`-types for type-safe
// data() access — narrower than unified's `Plugin` signature, but
// structurally compatible at runtime.

/** Chat answers: `$…$` and `$$…$$` are math. */
export const CHAT_REMARK_PLUGINS = [
  remarkDisableIndentedCode,
  remarkCjkAttention,
  remarkGfm,
  // Parse `$…$`/`$$…$$` into `language-math` nodes for rehypeKatex.
  remarkMath,
] as PluggableList;

/**
 * Task comments and descriptions: the chat list, except that a single `$`
 * is a dollar sign and four leading spaces make code. People write amounts
 * there ("$500 approved by @mia, $200 left"), and two of them would
 * otherwise turn the words between into a formula — a mention among them
 * included; `$$…$$` is still math. And task text is written by people and
 * imported from issue trackers, whose stack traces and logs are indented
 * code far more often than an indented paragraph is meant.
 */
export const TASK_REMARK_PLUGINS = [
  remarkCjkAttention,
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
] as PluggableList;
