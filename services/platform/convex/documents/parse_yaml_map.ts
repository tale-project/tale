/**
 * Minimal YAML reader — the inverse of `serializeYamlMap`. Reads a flat
 * string→string map (operator-authored config like `validation-policy.yaml`): one
 * `key: "value"` per line. Double-quoted values are unescaped; bare and
 * single-quoted values are tolerated too (hand-uploaded files vary). `#`
 * comments and blank lines are ignored; nested/list YAML is deliberately
 * unsupported (only flat scalar keys are returned).
 *
 * Best-effort and never throws — its only job is to pre-fill a form from an
 * existing file, so malformed input yields whatever flat keys parsed cleanly.
 */
const KEY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") {
    return v.slice(1, -1);
  }
  return v;
}

export function parseYamlMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const m = KEY_LINE_RE.exec(line);
    if (!m) continue;
    let value = m[2];
    // A bare (unquoted) value may carry a trailing ` # comment`; a quoted one
    // keeps everything inside the quotes verbatim.
    if (!(value.trim().startsWith('"') || value.trim().startsWith("'"))) {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash);
    }
    // An empty value = a parent key introducing a nested block; skip it (we
    // only surface flat scalars).
    if (value.trim() === '') continue;
    out[m[1]] = unquote(value);
  }
  return out;
}
