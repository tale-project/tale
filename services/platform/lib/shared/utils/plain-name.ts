/**
 * The characters no plain name can carry — a folder, a project file, a
 * WebDAV path segment: the two path separators (`/`, `\`), the C0 controls
 * (U+0000–U+001F — a NUL cannot be stored at all, CR/LF/TAB splice into a
 * download disposition, a log line, a CSV export) and DEL (U+007F). ONE
 * class for every surface that names a thing in the organization tree, so
 * a name one door accepts is a name every other door accepts too: three
 * copies used to disagree, and a folder took the control character a file
 * beside it refused. Layer A — no imports.
 */
const FORBIDDEN_NAME_CHARS = /[/\\\u0000-\u001f\u007f]/;

/** True when `name` carries a character no plain name can. */
export function hasForbiddenNameChar(name: string): boolean {
  return FORBIDDEN_NAME_CHARS.test(name);
}

/** Which half of the class `name` trips, for a refusal that names it —
 * `separator` for `/` or `\`, `control` for a C0 control or DEL — or
 * `undefined` for a name the class lets through. One regex, so the
 * sentence can never disagree with the check. */
export function forbiddenNameCharKind(
  name: string,
): 'separator' | 'control' | undefined {
  const match = FORBIDDEN_NAME_CHARS.exec(name);
  if (match === null) return undefined;
  return match[0] === '/' || match[0] === '\\' ? 'separator' : 'control';
}
