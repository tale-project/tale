import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail: a settings row turns on its surface's width, so the classes a
 * caller adds must turn with it. A viewport breakpoint (`sm:items-center`)
 * already applies while the row is still stacked in a narrow pane — beside
 * the settings panel, inside a dialog — where it centres the label and the
 * control across the column instead of lining them up in the row. Spell
 * row-mode classes with the row's own container variant,
 * `@xl/field-layout:` (see `FIELD_ROW_FRAME` in `@tale/ui/field-shell`).
 *
 * A pure source walk (no DOM), like `../list-conventions.test.ts`.
 */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ROW_TAG = /<(?:SettingsFieldRow|SettingsRow)\b/g;
const VIEWPORT_VARIANT = /(?:^|[\s'"`])(?:sm|md|lg|xl|2xl):/;

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

/**
 * The row's own `className` value — only an attribute of the opening tag
 * itself, never one inside a prop's JSX (a description's link, say).
 */
function rowClassName(src: string, start: number): string | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start; i < src.length; i++) {
    const char = src[i];
    if (quote !== undefined) {
      if (char === quote && src[i - 1] !== '\\') quote = undefined;
      continue;
    }
    if (depth === 0 && src.startsWith('className=', i)) {
      const value = src.slice(i + 'className='.length);
      if (value.startsWith('"')) return value.slice(1, value.indexOf('"', 1));
      // An expression: everything up to its closing brace.
      let braces = 0;
      for (let j = 0; j < value.length; j++) {
        if (value[j] === '{') braces++;
        else if (value[j] === '}' && --braces === 0) {
          return value.slice(0, j + 1);
        }
      }
      return value;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0) return undefined;
  }
  return undefined;
}

describe('settings row callers', () => {
  it('add no viewport breakpoint classes to a row', () => {
    const offenders: string[] = [];
    for (const file of listSources(APP_DIR)) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(ROW_TAG)) {
        const className = rowClassName(src, match.index);
        if (className !== undefined && VIEWPORT_VARIANT.test(className)) {
          offenders.push(`${relative(APP_DIR, file)}: ${className}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
