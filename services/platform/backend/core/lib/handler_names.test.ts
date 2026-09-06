// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

/**
 * The vocabulary gate's other half. `ctx-shim-reachability.ts` proves every
 * name reused code can REACH has a handler; nothing proved the reverse — that
 * every name the vocabulary DECLARES is still named by something. Retired 0.4
 * modules left their leaves behind (and a hostname-scraping pass once added
 * `api.openai.com` as `openai.com`), until the file read like a checklist in
 * which a genuinely unanswered name could hide. A leaf is live when code
 * builds the reference (`internal.a.b.c` / `api.a.b.c`, outside comments and
 * strings) or a shim table registers its name (`'a/b:c'`).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(HERE, '..', '..', '..');
const VOCABULARY = path.join(HERE, 'handler_names.ts');
/** The two modules that define the reference format rather than use it. */
const SKIPPED = new Set([
  VOCABULARY,
  path.join(PLATFORM, 'lib/shared/handlers/function-refs.ts'),
]);

/** Every leaf of `HandlerNames`, dotted (`automations.mutations.claimRun`). */
function vocabularyLeaves(source: string): string[] {
  const start = source.indexOf('interface HandlerNames {');
  const end = source.indexOf('interface ComponentNames');
  const stack: string[] = [];
  const leaves: string[] = [];
  for (const line of source.slice(start, end).split('\n')) {
    const container = /^\s*(\w+): FunctionRef & \{/.exec(line);
    if (container?.[1] !== undefined) {
      stack.push(container[1]);
      continue;
    }
    const leaf = /^\s*(\w+): FunctionRef;/.exec(line);
    if (leaf?.[1] !== undefined) {
      leaves.push([...stack, leaf[1]].join('.'));
      continue;
    }
    if (/^\s*\};/.test(line) && stack.length > 0) stack.pop();
  }
  return leaves;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts') && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Split one module into the CODE that can build a reference and the STRING
 * literals that can key a shim table. Comments go first (a doc comment
 * quoting `internal.a.b.c` is prose, not a call), then strings (so a URL like
 * `https://api.openai.com` can never read as a reference), then line comments.
 */
function evidence(source: string): { code: string; strings: string[] } {
  const strings: string[] = [];
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(
      /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g,
      (literal) => {
        strings.push(literal.slice(1, -1));
        return ' ';
      },
    )
    .replace(/\/\/[^\n]*/g, ' ');
  return { code, strings };
}

function namedLeaves(): Set<string> {
  const named = new Set<string>();
  for (const root of ['backend', 'lib']) {
    for (const file of sourceFiles(path.join(PLATFORM, root))) {
      if (SKIPPED.has(file)) continue;
      const { code, strings } = evidence(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(
        /\b(?:internal|api)((?:\.[A-Za-z_]\w*)+)/g,
      )) {
        named.add((match[1] ?? '').slice(1));
      }
      for (const literal of strings) {
        // 'a/b:c' (a shim-table key) → 'a.b.c'.
        if (/^\w+(?:\/\w+)+:\w+$/.test(literal)) {
          named.add(literal.replace(':', '/').replaceAll('/', '.'));
        }
      }
    }
  }
  return named;
}

describe('the handler vocabulary', () => {
  const leaves = vocabularyLeaves(readFileSync(VOCABULARY, 'utf8'));

  test('parses to the hand-maintained tree, not an empty list', () => {
    // A parser silently missing the interface would pass the gate below
    // vacuously; the tree is well over a hundred names and never shrinks to
    // a handful without this test being rewritten with it.
    expect(leaves.length).toBeGreaterThan(100);
    expect(leaves).toContain('automations.mutations.claimRun');
  });

  test('every leaf is named by code or registered in a shim table', () => {
    const named = namedLeaves();
    const dead = leaves.filter((leaf) => !named.has(leaf));
    expect(
      dead,
      `handler_names.ts declares names nothing builds or registers — delete the leaf, or wire the handler: ${dead.join(', ')}`,
    ).toEqual([]);
  });
});
