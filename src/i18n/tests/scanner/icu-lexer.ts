/**
 * Tiny ICU lexer used by `icu-placeholder-parity` and `icu-plural-rules`.
 *
 * Extracts:
 *   - The flat set of placeholder names appearing in a value.
 *   - Whether the value uses `plural` / `selectordinal` / `select`.
 *   - For plural forms: the set of categories present (`one`, `other`,
 *     `=0`, `=1`, etc.).
 *
 * Tolerates malformed input: returns whatever it can parse, never throws.
 */

interface IcuShape {
  /** All placeholder names that appear in the value (deduplicated). */
  readonly placeholders: ReadonlySet<string>;
  /** True if at least one placeholder uses ICU `plural` form. */
  readonly hasPlural: boolean;
  /** True if at least one placeholder uses ICU `selectordinal` form. */
  readonly hasSelectOrdinal: boolean;
  /** True if at least one placeholder uses ICU `select` form. */
  readonly hasSelect: boolean;
  /**
   * Plural categories used per placeholder, keyed by placeholder name.
   * Categories include CLDR forms (`one`, `other`, …) and exact-match
   * (`=0`, `=1`, …).
   */
  readonly pluralCategories: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Lex an ICU value. Returns a structured shape descriptor. */
export function lexIcu(value: string): IcuShape {
  const placeholders = new Set<string>();
  const pluralCategoriesMut = new Map<string, Set<string>>();
  let hasPlural = false;
  let hasSelectOrdinal = false;
  let hasSelect = false;

  // Walk `{` regions; for each region, parse header.
  let i = 0;
  while (i < value.length) {
    if (value[i] !== '{') {
      i++;
      continue;
    }
    const start = i;
    let depth = 1;
    i++;
    while (i < value.length && depth > 0) {
      if (value[i] === '{') depth++;
      else if (value[i] === '}') depth--;
      i++;
    }
    const region = value.slice(start + 1, i - 1);
    parseIcuRegion(region, placeholders, pluralCategoriesMut, (flags) => {
      if (flags.plural) hasPlural = true;
      if (flags.selectordinal) hasSelectOrdinal = true;
      if (flags.select) hasSelect = true;
    });
  }

  // Convert mutable maps to readonly.
  const pluralCategories = new Map<string, ReadonlySet<string>>();
  for (const [k, v] of pluralCategoriesMut) pluralCategories.set(k, v);

  return {
    placeholders,
    hasPlural,
    hasSelectOrdinal,
    hasSelect,
    pluralCategories,
  };
}

function parseIcuRegion(
  region: string,
  placeholders: Set<string>,
  pluralCategories: Map<string, Set<string>>,
  flag: (f: {
    plural: boolean;
    selectordinal: boolean;
    select: boolean;
  }) => void,
): void {
  const m = /^\s*([\w-]+)\s*(?:,\s*(\w+))?(?:\s*,\s*([\s\S]*))?\s*$/.exec(
    region,
  );
  if (!m) return;
  const name = m[1];
  const form = m[2];
  const body = m[3];
  placeholders.add(name);
  if (form === 'plural') {
    flag({ plural: true, selectordinal: false, select: false });
    extractCategories(name, body ?? '', pluralCategories);
  } else if (form === 'selectordinal') {
    flag({ plural: false, selectordinal: true, select: false });
    extractCategories(name, body ?? '', pluralCategories);
  } else if (form === 'select') {
    flag({ plural: false, selectordinal: false, select: true });
  }
}

function extractCategories(
  name: string,
  body: string,
  out: Map<string, Set<string>>,
): void {
  let set = out.get(name);
  if (!set) {
    set = new Set();
    out.set(name, set);
  }
  // Each category is "<word> { ... }" or "=<n> { ... }".
  let i = 0;
  while (i < body.length) {
    const m = /(=?[\w-]+)\s*\{/.exec(body.slice(i));
    if (!m) break;
    set.add(m[1]);
    i += (m.index ?? 0) + m[0].length;
    // Skip the inner braces.
    let depth = 1;
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
      i++;
    }
  }
}
