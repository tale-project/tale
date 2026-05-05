import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

export interface MessagesUsageConfig {
  /** Absolute path to the service root (e.g. `services/web`). */
  serviceRoot: string;
  /** Override the messages directory. Defaults to `<serviceRoot>/messages`. */
  messagesDir?: string;
  /**
   * Top-level directories to scan for `t()` / `useT()` usage. Missing
   * directories are skipped. Defaults to `['app', 'components', 'hooks',
   * 'lib', 'convex']` so the same list works across services with different
   * layouts.
   */
  scanRoots?: string[];
  /**
   * Path to a newline-delimited allowlist of dynamic key prefixes. Defaults
   * to `<serviceRoot>/lib/i18n/keys-dynamic.txt`. The file is optional.
   */
  allowlistPath?: string;
  /**
   * Display path for the allowlist used in the failure message (so the
   * suggestion points to the relative path the user actually opens).
   * Defaults to a path relative to the monorepo root inferred from
   * `serviceRoot`.
   */
  allowlistDisplayPath?: string;
  /**
   * Files in `messagesDir` that are spread into every locale (their keys
   * count for orphan detection). Defaults to `['en.json', 'global.json']`.
   * The first entry is also used as the base locale.
   */
  baseFiles?: string[];
}

type Messages = Record<string, unknown>;

function isMessages(v: unknown): v is Messages {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(file: string): Messages {
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isMessages(raw)) {
    throw new Error(
      `Expected JSON object at top level of ${file}, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    );
  }
  return raw;
}

function flatten(
  obj: Messages,
  prefix = '',
  out = new Set<string>(),
): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isMessages(v)) {
      flatten(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

function loadAllowlist(allowlistPath: string): string[] {
  if (!fs.existsSync(allowlistPath)) return [];
  return fs
    .readFileSync(allowlistPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

// File globs to skip — non-runtime surfaces don't count as "users" of a key.
const SKIP_RE = /(\.test\.tsx?$|\.stories\.tsx?$|\.bench\.tsx?$)/;

// Directory names to prune from the walk: anything under these is non-runtime
// (tests, stories, benchmarks, fixtures). Helper or fixture files inside
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

// Any dotted string literal (looks like a translation key). Requires at
// least one dot to avoid matching every short literal.
const DOTTED_LITERAL_RE = /['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g;

// Heuristic: identifiers shaped `t<Capital><rest>` (e.g. `tTables`) follow
// the codebase convention where the suffix names the namespace. Only
// registered when the inferred namespace is a real top-level key.
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

interface SuffixWildcard {
  ns: string;
  suffix: string;
}

function buildUsedKeys(
  allFlatKeys: Set<string>,
  scanRoots: string[],
): {
  exact: Set<string>;
  wildcardPrefixes: string[];
  wildcardSuffixes: SuffixWildcard[];
} {
  const exact = new Set<string>();
  const wildcardPrefixes = new Set<string>();
  // `t(`${var}.suffix`)` — pairs of (namespace, suffix). Each entry covers
  // every `<ns>.<one-segment>.<suffix>` key in the base files.
  const suffixesByNs = new Map<string, Set<string>>();

  // Top-level namespaces: keys of the base files. Used to validate the
  // t-alias heuristic and interpret bare dotted literals.
  const topLevelNamespaces = new Set<string>();
  for (const key of allFlatKeys) {
    const dot = key.indexOf('.');
    topLevelNamespaces.add(dot === -1 ? key : key.slice(0, dot));
  }

  const fileScans: Array<{
    file: string;
    content: string;
    aliases: Map<string, Set<string>>;
  }> = [];

  for (const root of scanRoots) {
    for (const file of walk(root)) {
      const content = fs.readFileSync(file, 'utf8');
      const aliases = new Map<string, Set<string>>();

      for (const m of content.matchAll(T_DESTRUCTURE_RE)) {
        const alias = m[1] ?? 't';
        recordAlias(aliases, alias, m[2]);
      }
      for (const m of content.matchAll(USE_TRANSLATION_ARRAY_RE)) {
        const alias = m[1] ?? 't';
        for (const inner of m[2].matchAll(ARRAY_NAMES_RE)) {
          recordAlias(aliases, alias, inner[1]);
        }
      }
      for (const m of content.matchAll(I18N_T_RE)) exact.add(m[1]);

      for (const m of content.matchAll(T_ALIAS_HEURISTIC_RE)) {
        const alias = m[1];
        const inferredNs = alias[1].toLowerCase() + alias.slice(2);
        if (topLevelNamespaces.has(inferredNs)) {
          recordAlias(aliases, alias, inferredNs);
        }
      }

      fileScans.push({ file, content, aliases });
    }
  }

  function recordSuffix(ns: string, suffix: string) {
    let set = suffixesByNs.get(ns);
    if (!set) {
      set = new Set();
      suffixesByNs.set(ns, set);
    }
    set.add(suffix);
  }

  // Second pass: walk every aliased call and every dotted literal. A
  // literal like `'import.errorCodes.unknown'` may be passed through to
  // `t()` later. Treat it as "used" iff its dotted prefix matches a known
  // namespace OR it exactly matches a flat key.
  for (const { content, aliases } of fileScans) {
    for (const [alias, namespaces] of aliases) {
      const literalRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*['"\`]([\\w.-]+)['"\`]`,
        'g',
      );
      // `t(\`prefix.${...}\`)` — static prefix, then variable.
      const templatePrefixRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*\`([\\w.-]+)\\.\\$\\{`,
        'g',
      );
      // `t(\`${...}.suffix\`)` — variable, then static suffix.
      const templateSuffixRe = new RegExp(
        `(?<![\\w$])${alias}\\(\\s*\`\\$\\{[^}]+\\}\\.([\\w-]+(?:\\.[\\w-]+)*)\``,
        'g',
      );
      // Capture the full argument body of `<alias>(...)` calls, supporting
      // up to one level of nested parens. The body pattern uses
      // mutually-exclusive alternatives so the outer `*` does not overlap
      // with the inner group — avoids catastrophic backtracking.
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
        if (suffix.includes('.')) exact.add(suffix);
      }
      for (const m of content.matchAll(templatePrefixRe)) {
        const prefix = m[1];
        for (const ns of namespaces) {
          wildcardPrefixes.add(`${ns}.${prefix}.`);
        }
      }
      for (const m of content.matchAll(templateSuffixRe)) {
        const suffix = m[1];
        for (const ns of namespaces) {
          recordSuffix(ns, suffix);
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

    // Indirect-string-key sweep: dotted string literals that resolve to a
    // real translation key. Tries (in order):
    //   1. literal matches a flat key as-is,
    //   2. literal is a key SUFFIX under a namespace registered in this file,
    //   3. cross-file lookup-table fallback: a dotted literal sitting in
    //      a "translation key" position — value of a `*Key` property,
    //      an `as const` cast, or argument of a bare `t(...)` call where
    //      `t` isn't bound in this file.
    const fileNamespaces = new Set<string>();
    for (const namespaces of aliases.values()) {
      for (const ns of namespaces) fileNamespaces.add(ns);
    }
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
    // positions that may be passed to `t(...)` dynamically. Membership in
    // `allFlatKeys` is the final filter.
    const localSingleCandidates = new Set<string>();
    const SINGLE_KEY_PROPERTY_RE = /\b\w*Key\s*:\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
    const SINGLE_AS_CONST_RE = /['"`]([a-zA-Z][\w-]*)['"`]\s*as\s+const\b/g;
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
    // Strong-signal candidates: values inside a const record whose name
    // contains `I18N`, `KEY(S)`, or `TRANSLATION(S)`.
    const strongSingleCandidates = new Set<string>();
    const I18N_RECORD_RE =
      /\b\w*(?:I18N|KEY|KEYS|TRANSLATION|TRANSLATIONS)\w*\b[^{]*?=\s*\{([^{}]*)\}/g;
    const RECORD_VALUE_RE = /:\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
    for (const block of content.matchAll(I18N_RECORD_RE)) {
      for (const m of block[1].matchAll(RECORD_VALUE_RE)) {
        strongSingleCandidates.add(m[1]);
      }
    }
    // Functions whose name ends in `Key` / `Keys` typically build a
    // translation-key suffix consumed via `t(<fnName>(args))` at the
    // callsite.
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

  const wildcardSuffixes: SuffixWildcard[] = [];
  for (const [ns, suffixes] of suffixesByNs) {
    for (const suffix of suffixes) {
      wildcardSuffixes.push({ ns, suffix });
    }
  }
  return { exact, wildcardPrefixes: [...wildcardPrefixes], wildcardSuffixes };
}

/**
 * Registers a vitest test that fails when any key in the base translation
 * files (e.g. `en.json` + `global.json`) has no reference in the service's
 * source code. Dynamic keys (constructed at runtime) can be exempted via
 * the optional `keys-dynamic.txt` allowlist.
 */
export function defineMessagesUsageTests(config: MessagesUsageConfig): void {
  const {
    serviceRoot,
    messagesDir = path.join(serviceRoot, 'messages'),
    scanRoots = ['app', 'components', 'hooks', 'lib', 'convex'],
    allowlistPath = path.join(serviceRoot, 'lib/i18n/keys-dynamic.txt'),
    baseFiles = ['en.json', 'global.json'],
  } = config;
  const allowlistDisplayPath =
    config.allowlistDisplayPath ?? path.relative(process.cwd(), allowlistPath);

  const resolvedScanRoots = scanRoots.map((d) =>
    path.isAbsolute(d) ? d : path.join(serviceRoot, d),
  );

  const allKeys = new Set<string>();
  for (const file of baseFiles) {
    const full = path.join(messagesDir, file);
    if (!fs.existsSync(full)) continue;
    for (const k of flatten(readJson(full))) allKeys.add(k);
  }

  const allowlist = loadAllowlist(allowlistPath);
  const used = buildUsedKeys(allKeys, resolvedScanRoots);

  function isCovered(key: string): boolean {
    if (used.exact.has(key)) return true;
    for (const prefix of used.wildcardPrefixes) {
      if (key.startsWith(prefix)) return true;
    }
    for (const { ns, suffix } of used.wildcardSuffixes) {
      const head = `${ns}.`;
      const tail = `.${suffix}`;
      if (!key.startsWith(head)) continue;
      if (!key.endsWith(tail)) continue;
      const middle = key.slice(head.length, key.length - tail.length);
      if (middle.length > 0 && !middle.includes('.')) return true;
    }
    for (const allowed of allowlist) {
      if (key === allowed || key.startsWith(`${allowed}.`)) return true;
    }
    return false;
  }

  describe('i18n keys are used in source', () => {
    it('every key in base files is referenced by source code', () => {
      const orphans: string[] = [];
      for (const key of allKeys) {
        if (!isCovered(key)) orphans.push(key);
      }
      orphans.sort();
      expect(
        orphans,
        `${orphans.length} orphan translation key(s) — defined in ${baseFiles.join(' + ')} but not referenced by source. ` +
          `If a key is constructed dynamically (e.g. via enum), add its prefix to ${allowlistDisplayPath} instead of leaving it orphan.\n  ` +
          orphans.join('\n  '),
      ).toEqual([]);
    });
  });
}
