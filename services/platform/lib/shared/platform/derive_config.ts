/**
 * Per-install app config derivation — the generic mechanism that lets an app
 * collect ONE input but store several keys.
 *
 * An app's `requires.config` field may declare a `derive` rule (a regex +
 * target keys). The config form renders one input for the field; on save this
 * splits the entered string into the declared sub-keys, which is what the app's
 * views and scheduled workflows actually bind (`$config:owner`, `{repo}`, …).
 * The platform carries no domain knowledge — the regex and target keys live in
 * the app manifest. Example: a single "owner/repo or GitHub URL" input deriving
 * `owner` + `repo`.
 *
 * Pure + isomorphic: the form runs it before calling `setAppConfig`, so the
 * stored map already holds both the raw input (for the form to read back) and
 * the derived keys (for the bindings). No FS or manifest read needed server-side.
 */

/** The subset of an `AppConfigField` this module needs. */
export interface DerivableConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean';
  derive?: { pattern: string; into: string[] };
}

export interface DeriveConfigResult {
  /** The map to persist: each field's raw value PLUS every derived sub-key. */
  values: Record<string, string | number | boolean>;
  /** Field keys whose `derive` rule didn't match the entered value (non-empty
   *  input that the form should flag and refuse to save). */
  invalid: string[];
}

/**
 * Config inputs are short identifiers / URLs; cap the length before running a
 * manifest-supplied regex so a pathological pattern can't be fed a huge string
 * (a cheap ReDoS guard — over-long input is treated as a non-match).
 */
const MAX_DERIVE_INPUT = 300;

function coerce(
  type: DerivableConfigField['type'],
  value: unknown,
): string | number | boolean {
  if (type === 'boolean') return value === true;
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Expand raw form values into the map to store. For a plain field the value is
 * coerced and kept as-is. For a `derive` field the raw string is kept under the
 * field's own key (so the form reads it back) AND split into the `into` keys:
 *
 *  - non-empty input that matches → the captured groups land under `into`;
 *  - non-empty input that does NOT match → `key` reported in `invalid`, no
 *    sub-keys written (the caller should refuse the save);
 *  - empty/cleared input → only the (empty) raw is written, no sub-keys — so an
 *    unconfigured app resolves `$config:<subKey>` to `undefined` and its views
 *    can skip the call instead of sending a blank target.
 */
export function deriveConfigValues(
  fields: DerivableConfigField[],
  raw: Record<string, string | boolean>,
): DeriveConfigResult {
  const values: Record<string, string | number | boolean> = {};
  const invalid: string[] = [];

  for (const field of fields) {
    const rawValue = raw[field.key];
    values[field.key] = coerce(field.type, rawValue);

    if (!field.derive) continue;

    const text = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (text === '') continue; // cleared → leave sub-keys unset

    const groups = matchDerive(field.derive, text);
    if (!groups) {
      invalid.push(field.key);
      continue;
    }
    field.derive.into.forEach((subKey, i) => {
      values[subKey] = groups[i];
    });
  }

  return { values, invalid };
}

/**
 * Run one derive rule. Returns the captured groups (one per `into` entry) or
 * `null` if the input is too long, the pattern is invalid, it doesn't match, or
 * it captures fewer groups than `into` needs.
 */
function matchDerive(
  derive: { pattern: string; into: string[] },
  text: string,
): string[] | null {
  if (text.length > MAX_DERIVE_INPUT) return null;
  let re: RegExp;
  try {
    re = new RegExp(derive.pattern);
  } catch (err) {
    console.warn(`[deriveConfig] invalid pattern ${derive.pattern}:`, err);
    return null;
  }
  const match = re.exec(text);
  if (!match) return null;
  const groups: string[] = [];
  for (let i = 0; i < derive.into.length; i++) {
    const g = match[i + 1];
    if (g === undefined) return null;
    groups.push(g);
  }
  return groups;
}
