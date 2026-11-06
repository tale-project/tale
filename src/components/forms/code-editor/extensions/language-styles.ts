import { styleTags, tags as t } from '@lezer/highlight';

import { codeTags } from '../../../../lib/code-roles';

/**
 * Style tags the editor adds to the stock grammars so a value takes the
 * colour the read-only grammars (TextMate, through Shiki) give it. A rule
 * added here replaces the stock rule for the same node.
 */

/**
 * TextMate names a `const` binding `variable.other.constant`; Lezer cannot
 * tell `const` from `let`, and most bindings in a transform body are `const`.
 * A statement's `;` is plain text there, a `,` a separator; the `:` of an
 * object literal and `...` are keywords.
 */
export const javascriptStyles = styleTags({
  'VariableDeclaration/VariableDefinition ForOfSpec/VariableDefinition ForInSpec/VariableDefinition':
    t.constant(t.variableName),
  ';': t.punctuation,
  ': Spread': t.keyword,
});

/** JSON keys are keywords in the read-only palette (`property-name.json`). */
export const jsonStyles = styleTags({
  PropertyName: codeTags.jsonKey,
});

/**
 * YAML keys are keywords and so is the `:` after them; a plain or quoted
 * value is a string expression and a block scalar a string, as TextMate
 * scopes them.
 */
export const yamlStyles = styleTags({
  'Key/Literal Key/QuotedLiteral': codeTags.yamlKey,
  Literal: codeTags.yamlValue,
  QuotedLiteral: codeTags.yamlValue,
  BlockLiteralContent: codeTags.yamlBlock,
  BlockLiteralHeader: t.keyword,
  ':': t.keyword,
  '-': t.punctuation,
});
