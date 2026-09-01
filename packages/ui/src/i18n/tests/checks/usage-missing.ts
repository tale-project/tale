/**
 * Reverse of the `usage` (orphan) check: a `t('literal')` call whose key does
 * not exist in the base catalog renders the RAW KEY in the UI — the bug class
 * where a namespace rework drops a whole subtree from every locale and both
 * `parity` (locales vs en) and `usage` (defined-but-unreferenced) stay green
 * (e.g. `automations.metrics.*`, #2414).
 *
 * Deliberately strict to stay false-positive free:
 *   - only `t`-style aliases whose `useT`/`useTranslation` binding names
 *     KNOWN top-level namespaces (all of them, for array bindings);
 *   - only static single/double-quoted first arguments (no templates);
 *   - literals ending in `.` are prefix concatenations — skipped;
 *   - calls passing `defaultValue` render their fallback — skipped;
 *   - the `keys-dynamic.yml` allowlist is honored for both the resolved
 *     `<ns>.<literal>` key and the bare literal.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ARRAY_NAMES_RE,
  flatten,
  loadAllowlist,
  readJson,
  T_DESTRUCTURE_RE,
  USE_TRANSLATION_ARRAY_RE,
  walk,
} from '../usage';
import { createCheck, type Finding } from './types';

interface MissingKeyRefsConfig {
  /** Absolute path to the service root (e.g. `services/platform`). */
  serviceRoot: string;
  /** Override the messages directory. Defaults to `<serviceRoot>/messages`. */
  messagesDir?: string;
  /** Top-level directories to scan. Same default as the orphan check. */
  scanRoots?: ReadonlyArray<string>;
  /** Dynamic-prefix allowlist path (`keys-dynamic.yml`). */
  allowlistPath?: string;
  /** Base files whose keys form the catalog. */
  baseFiles?: string[];
}

/** 1-based line of a match index within `content`. */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Pure core — exported for the unit test. Walks the service source and
 * returns one finding per static `t()` call that resolves to no catalog key.
 */
export function findMissingKeyRefs(config: MissingKeyRefsConfig): Finding[] {
  const {
    serviceRoot,
    messagesDir = path.join(serviceRoot, 'messages'),
    scanRoots = ['app', 'components', 'hooks', 'lib', 'backend'],
    allowlistPath = path.join(serviceRoot, 'lib/i18n/keys-dynamic.yml'),
    baseFiles = ['en.yml', 'global.yml'],
  } = config;

  const allKeys = new Set<string>();
  for (const file of baseFiles) {
    const full = path.join(messagesDir, file);
    if (!fs.existsSync(full)) continue;
    for (const k of flatten(readJson(full))) allKeys.add(k);
  }
  if (allKeys.size === 0) return [];

  const topLevelNamespaces = new Set<string>();
  for (const key of allKeys) {
    const dot = key.indexOf('.');
    topLevelNamespaces.add(dot === -1 ? key : key.slice(0, dot));
  }

  const allowlist = loadAllowlist(allowlistPath);
  const allowlisted = (key: string): boolean =>
    allowlist.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));

  const findings: Finding[] = [];

  for (const root of scanRoots) {
    const rootDir = path.isAbsolute(root) ? root : path.join(serviceRoot, root);
    for (const file of walk(rootDir)) {
      const content = fs.readFileSync(file, 'utf8');

      // alias → bound namespaces; only aliases whose namespaces are ALL
      // known are checkable (an unknown namespace may resolve from another
      // package's catalog).
      const aliases = new Map<string, Set<string>>();
      const record = (alias: string, ns: string): void => {
        let set = aliases.get(alias);
        if (!set) {
          set = new Set();
          aliases.set(alias, set);
        }
        set.add(ns);
      };
      for (const m of content.matchAll(T_DESTRUCTURE_RE)) {
        record(m[1] ?? 't', m[2]);
      }
      for (const m of content.matchAll(USE_TRANSLATION_ARRAY_RE)) {
        for (const inner of m[2].matchAll(ARRAY_NAMES_RE)) {
          record(m[1] ?? 't', inner[1]);
        }
      }

      for (const [alias, namespaces] of aliases) {
        // A competing direct binding (`const t = useFallbackTranslator()`)
        // means calls through this alias may not hit the bound namespace at
        // all — ambiguous, so skip the alias for this file.
        const directBindingRe = new RegExp(
          `\\b(?:const|let|var)\\s+${alias}\\s*=`,
        );
        if (directBindingRe.test(content)) continue;
        const nsList = [...namespaces];
        if (!nsList.every((ns) => topLevelNamespaces.has(ns))) continue;

        // Static literal first arg; capture what follows the literal so an
        // options object can be inspected for `defaultValue`.
        const callRe = new RegExp(
          `(?<![\\w$])${alias}\\(\\s*['"]([\\w.-]+)['"]\\s*(,?)`,
          'g',
        );
        for (const m of content.matchAll(callRe)) {
          const literal = m[1];
          if (literal.endsWith('.')) continue; // prefix concatenation
          if (allKeys.has(literal)) continue; // fully-qualified key
          if (allowlisted(literal)) continue;

          const resolved = nsList.map((ns) => `${ns}.${literal}`);
          if (resolved.some((key) => allKeys.has(key))) continue;
          if (resolved.some((key) => allowlisted(key))) continue;

          // `t('key', { defaultValue: … })` renders its fallback — skip.
          if (m[2] === ',') {
            const rest = content.slice(
              (m.index ?? 0) + m[0].length,
              (m.index ?? 0) + m[0].length + 400,
            );
            if (/^\s*\{[^)]*\bdefaultValue\s*:/.test(rest)) continue;
          }

          findings.push({
            file: path.relative(serviceRoot, file),
            line: lineOf(content, m.index ?? 0),
            key: resolved[0],
            locale: 'en',
            rule: 'referenced-key-missing',
            detail: `t('${literal}') resolves to ${resolved.join(' / ')} — not defined in ${baseFiles.join(' + ')}, so the UI renders the raw key`,
            suggest:
              'Add the key to the base catalog (and every locale), or add its dynamic prefix to keys-dynamic.yml if it is constructed at runtime',
          });
        }
      }
    }
  }

  findings.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  return findings;
}

export const usageMissing = createCheck({
  id: 'usage-missing',
  scope: 'json',
  // Rollout default: report. Flip to `enforce` per service once its catalog
  // is clean (mirrors how the locale-quality checks rolled out).
  defaultMode: 'report',
  run(ctx) {
    if (!ctx.serviceRoot) return [];
    return findMissingKeyRefs({
      serviceRoot: ctx.serviceRoot,
      messagesDir: ctx.messagesDir,
      scanRoots: ctx.scanRoots,
      allowlistPath: ctx.allowlistPath,
    });
  },
});
