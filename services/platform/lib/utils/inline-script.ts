/**
 * Splicing runtime values into the served `index.html` — the `__ENV__` and
 * `__ACCEPT_LANGUAGE__` placeholders, the `<head>` additions. Shared by
 * `server.ts` (production) and the Vite dev/preview plugins, so every door
 * serves the same bytes.
 */

/**
 * `value` as a JavaScript literal for an inline `<script>`: its JSON, with
 * `<`, `>` and `&` written as `<`, `>` and `&`. No value — an
 * operator's URL, a request's Accept-Language — can then end the script
 * early with `</script>` or open an HTML comment in it, and the script still
 * reads the value back unchanged.
 */
export function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * `html` with the first match of `pattern` replaced by `text`, verbatim. A
 * string replacement would expand `$&`, `` $` ``, `$'` and `$$` inside
 * `text`, which splices the surrounding HTML into the value (a URL whose
 * query holds `` $` `` would break the page's script); a replacer function
 * inserts `text` as it is.
 */
export function replaceLiteral(
  html: string,
  pattern: string | RegExp,
  text: string,
): string {
  return html.replace(pattern, () => text);
}
