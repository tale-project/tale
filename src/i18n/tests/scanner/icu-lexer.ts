/**
 * Small ICU lexer used by `icu-placeholder-parity`, `icu-plural-rules` and
 * `placeholder-density`.
 *
 * Extracts:
 *   - The set of argument names in a value, including the ones inside
 *     plural/select branches.
 *   - Whether the value uses `plural` / `selectordinal` / `select`.
 *   - Every `plural` and `selectordinal`, nested ones included, with the
 *     selectors its branches use (`one`, `other`, `=0`, `=1`, …).
 *
 * Follows the quoting of the formatter the apps run (`intl-messageformat`
 * behind `i18next-icu`): `''` is an apostrophe, and `'` before `{`, `}`,
 * `<`, `>` — or `#` inside a plural branch — quotes text up to the next
 * single `'`, so quoted braces are text, not arguments.
 *
 * Tolerates malformed input: returns whatever it can parse, never throws.
 * `icu-brace-balance` is the check that reports values the formatter
 * cannot parse.
 */

/** One `plural` or `selectordinal` argument of a value. */
export interface IcuPlural {
  /** The argument it selects on (`count` in `{count, plural, …}`). */
  readonly name: string;
  readonly kind: 'plural' | 'selectordinal';
  /** The selectors of its branches: CLDR forms and `=<n>` matches. */
  readonly categories: ReadonlySet<string>;
}

interface IcuShape {
  /** All argument names in the value (deduplicated), at any depth. */
  readonly placeholders: ReadonlySet<string>;
  /** True if at least one argument uses ICU `plural` form. */
  readonly hasPlural: boolean;
  /** True if at least one argument uses ICU `selectordinal` form. */
  readonly hasSelectOrdinal: boolean;
  /** True if at least one argument uses ICU `select` form. */
  readonly hasSelect: boolean;
  /** Every plural and selectordinal, in the order they close. */
  readonly plurals: ReadonlyArray<IcuPlural>;
}

const PLURAL_KINDS: ReadonlySet<string> = new Set(['plural', 'selectordinal']);
const BRANCHING_KINDS: ReadonlySet<string> = new Set([
  ...PLURAL_KINDS,
  'select',
]);

/**
 * Index after the ICU quote that starts with the `'` at `i`: past `''`, past
 * a quoted run, or just past the `'` when it quotes nothing. `#` opens a
 * quoted run only inside a plural or selectordinal branch.
 */
export function skipIcuQuote(
  value: string,
  i: number,
  inPlural: boolean,
): number {
  const next = value[i + 1];
  if (next === "'") return i + 2;
  const opensRun =
    next === '{' ||
    next === '}' ||
    next === '<' ||
    next === '>' ||
    (next === '#' && inPlural);
  if (!opensRun) return i + 1;
  let j = i + 2;
  while (j < value.length) {
    if (value[j] !== "'") {
      j++;
    } else if (value[j + 1] === "'") {
      j += 2;
    } else {
      return j + 1;
    }
  }
  return j;
}

/** Lex an ICU value. Returns a structured shape descriptor. */
export function lexIcu(value: string): IcuShape {
  const placeholders = new Set<string>();
  const plurals: IcuPlural[] = [];
  const kinds = new Set<string>();

  const skipSpaces = (i: number): number => {
    let j = i;
    while (j < value.length && /\s/.test(value.charAt(j))) j++;
    return j;
  };
  const skipWord = (i: number): number => {
    let j = i;
    while (j < value.length && !/[\s,{}]/.test(value.charAt(j))) j++;
    return j;
  };

  // Skips a `{…}` the lexer cannot read, by depth; returns the index after
  // its closing brace.
  const skipBalanced = (open: number): number => {
    let depth = 0;
    let i = open;
    while (i < value.length) {
      const ch = value[i];
      if (ch === "'") {
        i = skipIcuQuote(value, i, false);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return i;
  };

  // Reads message text from `i`. In a branch (`nested`) it stops at the
  // `}` that closes the branch and returns its index; at the top level a
  // `}` is text.
  const readMessage = (
    i: number,
    inPlural: boolean,
    nested: boolean,
  ): number => {
    let j = i;
    while (j < value.length) {
      const ch = value[j];
      if (ch === "'") j = skipIcuQuote(value, j, inPlural);
      else if (ch === '{') j = readArgument(j);
      else if (ch === '}' && nested) return j;
      else j++;
    }
    return j;
  };

  // Reads the argument whose `{` is at `open` — `{name}`,
  // `{name, number, …}` or a plural/select with its branches — and returns
  // the index after its closing brace.
  const readArgument = (open: number): number => {
    let i = skipSpaces(open + 1);
    const nameEnd = skipWord(i);
    const name = value.slice(i, nameEnd);
    if (name === '') return skipBalanced(open);
    placeholders.add(name);
    i = skipSpaces(nameEnd);
    if (value[i] === '}') return i + 1;
    if (value[i] !== ',') return skipBalanced(open);
    i = skipSpaces(i + 1);
    const typeEnd = skipWord(i);
    const type = value.slice(i, typeEnd);
    i = skipSpaces(typeEnd);
    if (value[i] === '}') return i + 1;
    if (value[i] !== ',' || !BRANCHING_KINDS.has(type)) {
      // A number/date/time style, or something malformed.
      return skipBalanced(open);
    }
    kinds.add(type);
    const inPlural = PLURAL_KINDS.has(type);
    const categories = new Set<string>();
    i++;
    while (i < value.length) {
      i = skipSpaces(i);
      if (value[i] === '}') {
        i++;
        break;
      }
      const selectorEnd = skipWord(i);
      if (selectorEnd === i) {
        // A stray `,` or `{`: malformed, read on.
        i++;
        continue;
      }
      const selector = value.slice(i, selectorEnd);
      i = skipSpaces(selectorEnd);
      // `offset:1` is not followed by a branch.
      if (value[i] !== '{') continue;
      categories.add(selector);
      i = readMessage(i + 1, inPlural, true);
      if (value[i] === '}') i++;
    }
    if (type === 'plural' || type === 'selectordinal') {
      plurals.push({ name, kind: type, categories });
    }
    return i;
  };

  readMessage(0, false, false);
  return {
    placeholders,
    hasPlural: kinds.has('plural'),
    hasSelectOrdinal: kinds.has('selectordinal'),
    hasSelect: kinds.has('select'),
    plurals,
  };
}
