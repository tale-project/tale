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

// Directory names to prune from the walk: anything under these is non-runtime
// (tests, stories, benchmarks, fixtures). Helper or fixture files inside them
// would otherwise count as translation usage and mask orphan keys.
const PRUNE_DIRS = new Set([
  '__tests__',
  'tests',
  'stories',
  '__stories__',
  'benchmarks',
  '__mocks__',
  '__fixtures__',
  'fixtures',
]);

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
    if (entry.isDirectory() && PRUNE_DIRS.has(entry.name)) continue;
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

// Heuristic: identifiers shaped `t<Capital><rest>` (e.g. `tTables`,
// `tCustomers`, `tDocuments`) follow the codebase convention where the
// suffix names the namespace. We use this to recover translation aliases
// that are not destructured from `useT(...)` in the current file but
// instead arrive via a callback parameter or function argument:
//   ({ tTables, builders }) => [{ header: tTables('headers.product') }, ...]
//   function createCreationTimeColumn(tTables: TranslationFn) { ... }
// We only register the alias when the inferred namespace actually exists
// at the top level of en.json/global.json, so identifiers like `tEntity`
// (whose namespace is genuinely dynamic) are ignored.
const T_ALIAS_HEURISTIC_RE = /\b(t[A-Z]\w*)\(/g;

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

  // Top-level namespaces are the keys of en.json + global.json. We use
  // this set both to validate the t-alias heuristic (`tFoo` only counts
  // when `foo` is a real top-level namespace) and to interpret bare
  // dotted literals like `'vendors.title'`.
  const topLevelNamespaces = new Set<string>();
  for (const key of allFlatKeys) {
    const dot = key.indexOf('.');
    topLevelNamespaces.add(dot === -1 ? key : key.slice(0, dot));
  }

  const allNamespaces = new Set<string>();
  const fileScans: Array<{
    file: string;
    content: string;
    aliases: Map<string, Set<string>>;
  }> = [];

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

      // Heuristic alias detection: any `tFoo(...)` call where `Foo`
      // names a real top-level namespace is treated as `tFoo` aliasing
      // that namespace, even when no `useT('foo')` appears in the file.
      // Skips identifiers like `tEntity` whose namespace is dynamic.
      for (const m of content.matchAll(T_ALIAS_HEURISTIC_RE)) {
        const alias = m[1];
        const inferredNs = alias[1].toLowerCase() + alias.slice(2);
        if (topLevelNamespaces.has(inferredNs)) {
          recordAlias(aliases, alias, inferredNs);
          allNamespaces.add(inferredNs);
        }
      }

      fileScans.push({ file, content, aliases });
    }
  }

  // Second pass: for each file, walk every aliased call and every dotted
  // literal. Key insight: a literal like `'import.errorCodes.unknown'` in
  // any file may be passed through to `t()` later via a variable lookup.
  // Treat it as "used" iff its dotted prefix matches a known namespace OR
  // it exactly matches a flat key in en.json.
  for (const { content, aliases } of fileScans) {
    for (const [alias, namespaces] of aliases) {
      const literalRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*['"\`]([\\w.-]+)['"\`]`,
        'g',
      );
      const templateRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*\`([\\w.-]+)\\.\\$\\{`,
        'g',
      );
      // Capture the full argument body of `<alias>(...)` calls, supporting
      // up to one level of nested parens. This catches keys passed via
      // ternaries / inline expressions, e.g.
      //   t(isDisabled ? 'disabled' : 'noMembership')
      //   t(cond ? 'a.b' : 'a.c', params)
      const callBodyRe = new RegExp(
        `(?<![\\w$])${alias}\\(((?:[^()]|\\([^()]*\\))*)\\)`,
        'g',
      );
      const innerLiteralRe = /['"`]([\w-]+(?:\.[\w-]+)*)['"`]/g;

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
      for (const m of content.matchAll(callBodyRe)) {
        const body = m[1];
        for (const lit of body.matchAll(innerLiteralRe)) {
          const candidate = lit[1];
          for (const ns of namespaces) {
            const fullKey = `${ns}.${candidate}`;
            if (allFlatKeys.has(fullKey)) exact.add(fullKey);
          }
          if (candidate.includes('.') && allFlatKeys.has(candidate)) {
            exact.add(candidate);
          }
        }
      }
    }

    // Indirect-string-key sweep: dotted string literals that resolve
    // to a real translation key. We try, in order:
    //   1. literal matches a flat key as-is (`'tables.headers.name'`),
    //   2. literal's first segment is a known top-level namespace
    //      (`'vendors.title'` → `vendors` is a namespace),
    //   3. literal is a key SUFFIX under a namespace registered in this
    //      file (`'headers.product'` in a file where `tables` is bound,
    //      via `useT('tables')` or the `tTables` heuristic),
    //   4. cross-file lookup-table fallback: a dotted literal sitting in
    //      a "translation key" position — value of a `*Key` property
    //      (`labelKey: 'modelSelector.tags.chat'`), an `as const` cast
    //      (`'priority.high' as const`), or argument of a bare `t(...)`
    //      call where `t` isn't bound in this file (the t function came
    //      in via a custom hook return). For these we search every
    //      namespace, since the suffix's namespace is determined cross-
    //      file and can't be inferred locally.
    // Step 3's per-file restriction prevents accidental matches from
    // unrelated namespaces (e.g. `'pii.blocked'` discriminator codes
    // would otherwise resurrect `governance.pii.blocked`).
    const fileNamespaces = new Set<string>();
    for (const namespaces of aliases.values()) {
      for (const ns of namespaces) fileNamespaces.add(ns);
    }
    // Lookup-table literals: dotted strings sitting in positions that
    // hint at translation-key storage (a `*Key` property, an `as const`
    // cast, or the argument of a bare `t(...)` call where `t` isn't
    // bound here). For these we permit a global namespace search since
    // the alias resolution happens in another file.
    const lookupTableLiterals = new Set<string>();
    const KEY_PROPERTY_DOT_RE =
      /\b\w*Key\s*:\s*['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g;
    const AS_CONST_DOT_RE = /['"`]([\w-]+(?:\.[\w-]+)+)['"`]\s*as\s+const\b/g;
    const BARE_T_CALL_DOT_RE =
      /(?<![\w$])t\(\s*['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g;
    for (const m of content.matchAll(KEY_PROPERTY_DOT_RE)) {
      lookupTableLiterals.add(m[1]);
    }
    for (const m of content.matchAll(AS_CONST_DOT_RE)) {
      lookupTableLiterals.add(m[1]);
    }
    if (!aliases.has('t')) {
      for (const m of content.matchAll(BARE_T_CALL_DOT_RE)) {
        lookupTableLiterals.add(m[1]);
      }
    }
    const consumesTranslationFn =
      /\bTFunction\b/.test(content) ||
      /\bt\s*:\s*\(\s*key\s*:\s*string/.test(content);
    if (consumesTranslationFn) {
      for (const m of content.matchAll(DOTTED_LITERAL_RE)) {
        lookupTableLiterals.add(m[1]);
      }
    }

    // Single-segment literal candidates: identifiers stored in property
    // positions (`title: 'deleteCustomer'`, `i18nKey: 'errorHintAuthError'`,
    // inside `keys: { ... }` blocks, etc.) that are passed to `t(...)`
    // dynamically. Translation keys in this codebase are camelCase
    // identifiers, so we collect single-word strings sitting in clear
    // key-storage positions and try them against the file's namespaces
    // (or globally when the file imports `TFunction` / has an unbound
    // `t`). Membership in `allFlatKeys` is the final filter, so the
    // false-positive rate stays low.
    // Local single-segment candidates: literals stored in property
    // positions inside this file. Resolved against the file's own
    // namespaces.
    const localSingleCandidates = new Set<string>();
    const SINGLE_KEY_PROPERTY_RE = /\b\w*Key\s*:\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
    const SINGLE_AS_CONST_RE = /['"`]([a-zA-Z][\w-]*)['"`]\s*as\s+const\b/g;
    // Inside a `keys: { ... }` object, every string-literal property
    // value is a candidate translation key.
    const KEYS_BLOCK_RE = /\bkeys\s*:\s*\{([^{}]*)\}/g;
    const KEYS_BLOCK_VALUE_RE = /:\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
    for (const m of content.matchAll(SINGLE_KEY_PROPERTY_RE)) {
      localSingleCandidates.add(m[1]);
    }
    for (const m of content.matchAll(SINGLE_AS_CONST_RE)) {
      localSingleCandidates.add(m[1]);
    }
    for (const block of content.matchAll(KEYS_BLOCK_RE)) {
      for (const m of block[1].matchAll(KEYS_BLOCK_VALUE_RE)) {
        localSingleCandidates.add(m[1]);
      }
    }
    // Strong-signal single-segment candidates: values inside a const
    // record whose name contains `I18N`, `KEY(S)`, or `TRANSLATION(S)`
    // (e.g. `CATEGORY_I18N_KEY`, `TAG_KEYS`). These are translation
    // key suffixes consumed cross-file via a t-fn and so deserve a
    // global namespace search regardless of where the t-fn is bound.
    // The lazy `[^{]*?` lets us skip over an optional type annotation
    // (`Record<X, string>`) before reaching the object literal.
    const strongSingleCandidates = new Set<string>();
    const I18N_RECORD_RE =
      /\b\w*(?:I18N|KEY|KEYS|TRANSLATION|TRANSLATIONS)\w*\b[^{]*?=\s*\{([^{}]*)\}/g;
    const RECORD_VALUE_RE = /:\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
    for (const block of content.matchAll(I18N_RECORD_RE)) {
      for (const m of block[1].matchAll(RECORD_VALUE_RE)) {
        strongSingleCandidates.add(m[1]);
      }
    }
    // Functions whose name ends in `Key` / `Keys` (e.g. `statusLabelKey`,
    // `presetLabelKey`) typically build a translation-key suffix, then
    // get consumed via `t(<fnName>(args))` at the callsite. We collect
    // every string literal returned by such a function and treat the
    // values as strong candidates. Match the function header with a
    // regex, then walk the body counting `{`/`}` to find the true
    // closing brace — a lazy regex would stop at any inner `}` (e.g.
    // inside an `if`/`else` block) and miss later `return` statements.
    const KEY_FUNCTION_HEADER_RE =
      /\bfunction\s+\w*[Kk]eys?\s*\([^)]*\)[^{]*\{/g;
    const RETURN_LITERAL_RE = /\breturn\s+['"`]([\w-]+(?:\.[\w-]+)*)['"`]/g;
    for (const m of content.matchAll(KEY_FUNCTION_HEADER_RE)) {
      const bodyStart = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let i = bodyStart;
      while (i < content.length && depth > 0) {
        const c = content[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      if (depth !== 0) continue;
      const body = content.slice(bodyStart, i - 1);
      for (const r of body.matchAll(RETURN_LITERAL_RE)) {
        strongSingleCandidates.add(r[1]);
      }
    }
    for (const literal of localSingleCandidates) {
      let matched = false;
      for (const ns of fileNamespaces) {
        const candidate = `${ns}.${literal}`;
        if (allFlatKeys.has(candidate)) {
          exact.add(candidate);
          matched = true;
        }
      }
      if (!matched && consumesTranslationFn) {
        for (const ns of topLevelNamespaces) {
          const candidate = `${ns}.${literal}`;
          if (allFlatKeys.has(candidate)) exact.add(candidate);
        }
      }
    }
    for (const literal of strongSingleCandidates) {
      // Prefer per-file namespaces when the file has a `useT(...)` /
      // heuristic alias bound (e.g. `statusLabelKey` returning `'statusPending'`
      // in a file that does `useT('todoList')` should only mark
      // `todoList.statusPending`, not every other namespace that happens
      // to also have a `statusPending` key). Fall back to a global
      // namespace search only when the file binds nothing — the
      // canonical case is a translation-key map declared in a util that
      // is consumed by another file (e.g. `CATEGORY_I18N_KEY` in
      // `sanitize-chat-error.ts`).
      let matched = false;
      for (const ns of fileNamespaces) {
        const candidate = `${ns}.${literal}`;
        if (allFlatKeys.has(candidate)) {
          exact.add(candidate);
          matched = true;
        }
      }
      if (!matched && fileNamespaces.size === 0) {
        for (const ns of topLevelNamespaces) {
          const candidate = `${ns}.${literal}`;
          if (allFlatKeys.has(candidate)) exact.add(candidate);
        }
      }
    }

    for (const m of content.matchAll(DOTTED_LITERAL_RE)) {
      const literal = m[1];
      if (allFlatKeys.has(literal)) {
        exact.add(literal);
        continue;
      }
      let matched = false;
      for (const ns of fileNamespaces) {
        const candidate = `${ns}.${literal}`;
        if (allFlatKeys.has(candidate)) {
          exact.add(candidate);
          matched = true;
        }
      }
      if (matched) continue;
      if (lookupTableLiterals.has(literal)) {
        for (const ns of topLevelNamespaces) {
          const candidate = `${ns}.${literal}`;
          if (allFlatKeys.has(candidate)) exact.add(candidate);
        }
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
