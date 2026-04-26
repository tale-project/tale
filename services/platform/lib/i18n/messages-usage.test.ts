import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_ROOT = path.resolve(HERE, '../..');
const MESSAGES_DIR = path.join(PLATFORM_ROOT, 'messages');

// Source roots to scan for t() / useT() usage.
const SCAN_ROOTS = ['app', 'components', 'hooks', 'lib', 'convex'].map((d) =>
  path.join(PLATFORM_ROOT, d),
);

// File globs to skip — non-runtime surfaces don't count as "users" of a key.
const SKIP_RE = /(\.test\.tsx?$|\.stories\.tsx?$|\.bench\.tsx?$)/;

// Dynamic-key allowlist. Each line is a dotted prefix; any en.json key that
// starts with a listed prefix is exempt from orphan detection. Use this when
// keys are constructed at runtime in ways the regex below cannot follow
// (enum-driven, deeply indirect, etc.).
const ALLOWLIST_PATH = path.join(HERE, 'keys-dynamic.txt');

type Messages = Record<string, unknown>;

function readJson(file: string): Messages {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Messages;
}

function flatten(
  obj: Messages,
  prefix = '',
  out = new Set<string>(),
): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v as Messages, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

function loadAllowlist(): string[] {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  return fs
    .readFileSync(ALLOWLIST_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !SKIP_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// `const { t: tVendors } = useT('vendors')` or `useTranslation('vendors')` —
// captures alias name and namespace. Falls back to `t` when no alias is given.
const T_DESTRUCTURE_RE =
  /\{\s*t(?:\s*:\s*(\w+))?\s*\}\s*=\s*use(?:T|Translation)\(\s*(?:\[\s*)?['"`]([\w.-]+)['"`]/g;

// `useTranslation(['ns1', 'ns2'])` — array of namespaces.
const USE_TRANSLATION_ARRAY_RE =
  /\{\s*t(?:\s*:\s*(\w+))?\s*\}\s*=\s*useTranslation\(\s*\[([^\]]+)\]/g;
const ARRAY_NAMES_RE = /['"`]([\w.-]+)['"`]/g;

// `i18n.t('full.key')` — bypasses the namespace machinery entirely.
const I18N_T_RE = /\bi18n\.t\(\s*['"`]([\w.-]+)['"`]/g;

// Any dotted string literal (looks like a translation key). Matches
// `'foo.bar.baz'`, `"foo.bar"`, `` `foo.bar` ``. We use this to catch keys
// that are stored in lookup tables or passed through helpers before reaching
// `t()`. Requires at least one dot to avoid matching every short literal.
const DOTTED_LITERAL_RE = /['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g;

function recordAlias(
  aliases: Map<string, Set<string>>,
  alias: string,
  ns: string,
) {
  let set = aliases.get(alias);
  if (!set) {
    set = new Set();
    aliases.set(alias, set);
  }
  set.add(ns);
}

function buildUsedKeys(allFlatKeys: Set<string>): {
  exact: Set<string>;
  wildcardPrefixes: string[];
} {
  const exact = new Set<string>();
  const wildcardPrefixes = new Set<string>();

  // First pass: collect every namespace ever registered anywhere. This is
  // used in the second pass to interpret bare dotted literals like
  // `'vendors.title'` — if `vendors` is a known namespace, the literal
  // covers `vendors.title`.
  const allNamespaces = new Set<string>();
  const fileScans: Array<{ file: string; aliases: Map<string, Set<string>> }> =
    [];

  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const content = fs.readFileSync(file, 'utf8');
      const aliases = new Map<string, Set<string>>();

      for (const m of content.matchAll(T_DESTRUCTURE_RE)) {
        const alias = m[1] ?? 't';
        recordAlias(aliases, alias, m[2]);
        allNamespaces.add(m[2]);
      }
      for (const m of content.matchAll(USE_TRANSLATION_ARRAY_RE)) {
        const alias = m[1] ?? 't';
        for (const inner of m[2].matchAll(ARRAY_NAMES_RE)) {
          recordAlias(aliases, alias, inner[1]);
          allNamespaces.add(inner[1]);
        }
      }
      for (const m of content.matchAll(I18N_T_RE)) exact.add(m[1]);

      fileScans.push({ file, aliases });
    }
  }

  // Second pass: for each file, walk every aliased call and every dotted
  // literal. Key insight: a literal like `'import.errorCodes.unknown'` in
  // any file may be passed through to `t()` later via a variable lookup.
  // Treat it as "used" iff its dotted prefix matches a known namespace OR
  // it exactly matches a flat key in en.json.
  for (const { file, aliases } of fileScans) {
    const content = fs.readFileSync(file, 'utf8');

    for (const [alias, namespaces] of aliases) {
      const literalRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*['"\`]([\\w.-]+)['"\`]`,
        'g',
      );
      const templateRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*\`([\\w.-]+)\\.\\$\\{`,
        'g',
      );

      for (const m of content.matchAll(literalRe)) {
        const suffix = m[1];
        for (const ns of namespaces) {
          exact.add(`${ns}.${suffix}`);
        }
        // Also treat dotted suffixes as full keys (helpers that pre-compose).
        if (suffix.includes('.')) exact.add(suffix);
      }
      for (const m of content.matchAll(templateRe)) {
        const prefix = m[1];
        for (const ns of namespaces) {
          wildcardPrefixes.add(`${ns}.${prefix}.`);
        }
      }
    }

    // Indirect-string-key sweep: any dotted string literal whose first
    // segment is a known namespace OR which matches a real flat key.
    for (const m of content.matchAll(DOTTED_LITERAL_RE)) {
      const literal = m[1];
      if (allFlatKeys.has(literal)) {
        exact.add(literal);
      } else {
        const firstSegment = literal.split('.')[0];
        if (allNamespaces.has(firstSegment)) exact.add(literal);
      }
    }
  }

  return { exact, wildcardPrefixes: [...wildcardPrefixes] };
}

const allKeys = new Set<string>([
  ...flatten(readJson(path.join(MESSAGES_DIR, 'en.json'))),
  ...flatten(readJson(path.join(MESSAGES_DIR, 'global.json'))),
]);

const allowlist = loadAllowlist();
const used = buildUsedKeys(allKeys);

function isCovered(key: string): boolean {
  if (used.exact.has(key)) return true;
  for (const prefix of used.wildcardPrefixes) {
    if (key.startsWith(prefix)) return true;
  }
  for (const allowed of allowlist) {
    if (key === allowed || key.startsWith(`${allowed}.`)) return true;
  }
  return false;
}

describe('i18n keys are used in source', () => {
  it('every key in en.json + global.json is referenced by source code', () => {
    const orphans: string[] = [];
    for (const key of allKeys) {
      if (!isCovered(key)) orphans.push(key);
    }
    orphans.sort();
    expect(
      orphans,
      `${orphans.length} orphan translation key(s) — defined in en.json/global.json but not referenced by source under app/, components/, hooks/, lib/, convex/. ` +
        `If a key is constructed dynamically (e.g. via enum), add its prefix to services/platform/lib/i18n/keys-dynamic.txt instead of leaving it orphan.\n  ` +
        orphans.join('\n  '),
    ).toEqual([]);
  });
});
