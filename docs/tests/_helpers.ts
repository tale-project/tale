import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// Never walk into dependency artefacts. Everything else that isn't a doc page
// (e.g. `scripts/`, `images/`, `tests/`) is listed in `.mintignore`.
const ALWAYS_SKIP_DIRS = new Set(['node_modules']);

// Locale folders are top-level dirs whose name matches a BCP-47-ish shape:
// a 2-letter language code with an optional region subtag (e.g. `de`, `fr-CH`).
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

type IgnoreRule = { re: RegExp; negate: boolean };

function loadIgnore(file: string): IgnoreRule[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  return lines.map((line) => {
    let negate = false;
    let pattern = line;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }
    const rooted =
      pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (pattern.endsWith('/')) pattern = pattern.slice(0, -1);

    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          re += '.*';
          i++;
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if ('.^$+{}()[]|\\'.includes(c)) {
        re += '\\' + c;
      } else {
        re += c;
      }
    }
    const anchor = rooted ? '^' : '(?:^|/)';
    return { re: new RegExp(`${anchor}${re}(?:/.*)?$`), negate };
  });
}

function isIgnored(relPath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negate;
  }
  return ignored;
}

const ignoreRules = loadIgnore(path.join(DOCS_ROOT, '.mintignore'));

/** Walk docs and return every `.md`/`.mdx` path (relative to docs root) that
 *  Mintlify would build — respecting `.mintignore`. */
export function walkDocs(
  dir: string = DOCS_ROOT,
  out: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(DOCS_ROOT, full);
    if (isIgnored(rel, ignoreRules)) continue;
    if (entry.isDirectory()) walkDocs(full, out);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))
      out.push(rel);
  }
  return out;
}

/** Top-level locale subdirectories (e.g. `['de', 'fr']`). */
export function discoverLocales(): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(DOCS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
    if (LOCALE_PATTERN.test(entry.name)) out.push(entry.name);
  }
  out.sort();
  return out;
}

/** Which locale a doc path belongs to: the leading segment if it matches a
 *  discovered locale, otherwise the base locale `'en'`. */
export function localeOf(
  relPath: string,
  locales: string[] = discoverLocales(),
): string {
  const first = relPath.split(path.sep)[0];
  return locales.includes(first) ? first : 'en';
}
