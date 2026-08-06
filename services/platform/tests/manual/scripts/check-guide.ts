/**
 * Static reference checker for the manual test guides — catches the drift that
 * makes a guide unexecutable: i18n keys that no longer resolve, routes that no
 * longer exist, and e2e spec citations whose file was deleted.
 *
 * It is an authoring aid, not a CI gate: run it on every guide you touch and
 * clear (or consciously justify) every finding before committing. A guide may
 * deliberately name a spec to say it does NOT exist — such negative mentions
 * are flagged too; read the finding in context.
 *
 * Usage (from the repo root):
 *
 *   bun services/platform/tests/manual/scripts/check-guide.ts \
 *     services/platform/tests/manual/chat.md [more guides…]
 *
 * The service is inferred from each guide's path (`services/<service>/tests/…`),
 * so platform and web guides can be mixed in one invocation. Checks per guide:
 *
 * 1. i18n keys — every backticked dotted token (`chat.send`, `settings.teams.*`)
 *    must resolve in `services/<service>/messages/en.yml` (+ `global.yml`);
 *    a trailing `.*` asserts the prefix exists as a group.
 * 2. Routes — every backticked absolute path (query strings stripped,
 *    `{param}` placeholders matched against `$param` segments) must match a
 *    `fullPath` in `services/<service>/app/routeTree.gen.ts`.
 * 3. Spec refs — every backticked `<name>.spec.ts` must exist under
 *    `services/<service>/tests/e2e/specs/`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

const repoRoot = resolve(import.meta.dir, '../../../../..');

function flattenKeys(node: unknown, prefix: string, into: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    into.add(path);
    flattenKeys(value, path, into);
  }
}

function loadMessages(service: string): Set<string> {
  const keys = new Set<string>();
  for (const file of ['en.yml', 'global.yml']) {
    const path = join(repoRoot, 'services', service, 'messages', file);
    if (!existsSync(path)) continue;
    flattenKeys(parse(readFileSync(path, 'utf8')), '', keys);
  }
  return keys;
}

function loadRoutes(service: string): string[] {
  const path = join(repoRoot, 'services', service, 'app', 'routeTree.gen.ts');
  if (!existsSync(path)) return [];
  const source = readFileSync(path, 'utf8');
  return (
    [...source.matchAll(/fullPath: '([^']+)'/g)]
      .map((m) => m[1])
      // Catch-all splat routes (`…/$`) render a 404 — matching against them
      // would make every dead URL look alive.
      .filter((route) => !route.split('/').includes('$'))
  );
}

function routeMatches(candidate: string, routes: string[]): boolean {
  const wanted = candidate.split('/').filter(Boolean);
  return routes.some((route) => {
    const have = route.split('/').filter(Boolean);
    if (have.length !== wanted.length) return false;
    return have.every((seg, i) => {
      const w = wanted[i];
      return seg === w || seg.startsWith('$') || w.startsWith('$');
    });
  });
}

// Prose often backticks web domains (`example.com`) and JS APIs
// (`page.evaluate`, `document.activeElement`) — neither is an i18n key.
const DOMAIN_TOKEN = /\.(com|org|net|dev|test|io|app)$/;
const JS_API_NAMESPACES = new Set([
  'page',
  'document',
  'documentElement',
  'window',
  'storage',
  'main',
  'process',
  'localStorage',
]);

const EXTENSION_TOKEN =
  /\.(ts|tsx|js|json|ya?ml|md|png|webp|svg|txt|zip|csv|html|css|xml)$/;

function checkGuide(guidePath: string): number {
  const absolute = resolve(guidePath);
  const serviceMatch = absolute.match(/services\/([^/]+)\/tests\//);
  if (!serviceMatch) {
    console.error(`SKIP ${guidePath}: cannot infer the service from the path`);
    return 1;
  }
  const service = serviceMatch[1];
  const text = readFileSync(absolute, 'utf8');
  const keys = loadMessages(service);
  const routes = loadRoutes(service);
  const findings: string[] = [];

  // 1. i18n keys — backticked dotted tokens that are not file names, web
  // domains, or JS API references in prose.
  const seenKeys = new Set<string>();
  for (const match of text.matchAll(
    /`([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_*-]+)+)`/g,
  )) {
    const token = match[1];
    if (
      seenKeys.has(token) ||
      EXTENSION_TOKEN.test(token) ||
      DOMAIN_TOKEN.test(token) ||
      JS_API_NAMESPACES.has(token.split('.')[0]) ||
      token.includes('..')
    )
      continue;
    seenKeys.add(token);
    const namespace = token.split('.')[0];
    if (!keys.has(namespace)) {
      findings.push(
        `UNKNOWN-NAMESPACE i18n \`${token}\` (no top-level \`${namespace}\` in en.yml)`,
      );
      continue;
    }
    const path = token.endsWith('.*') ? token.slice(0, -2) : token;
    if (!keys.has(path)) findings.push(`MISSING i18n \`${token}\``);
  }

  // 2. Routes — backticked absolute paths; placeholders match $param segments.
  const seenRoutes = new Set<string>();
  for (const match of text.matchAll(/`(\/[^\s`]*)`/g)) {
    let token = match[1];
    token = token.split('?')[0];
    if (token.length > 1) token = token.replace(/\/+$/, '');
    if (
      seenRoutes.has(token) ||
      token.includes('…') ||
      token.includes('<') ||
      token.startsWith('/api/') ||
      EXTENSION_TOKEN.test(token)
    ) {
      continue;
    }
    seenRoutes.add(token);
    const normalized = token
      .replace(/\{org\}/g, '$id')
      // Any other `{…}` placeholder — including `{a\|b}` alternations — is a
      // wildcard segment.
      .replace(/\{[^/{}]+\}/g, '$param');
    // Guides shorthand org-scoped routes ("reload `/contacts`") — retry with
    // the dashboard prefix before flagging.
    const matched =
      routeMatches(normalized, routes) ||
      (!normalized.startsWith('/dashboard') &&
        routeMatches(`/dashboard/$id${normalized}`, routes));
    if (routes.length > 0 && !matched) {
      findings.push(`DEAD route \`${token}\``);
    }
  }

  // 3. Spec refs — cited Playwright specs must exist.
  const seenSpecs = new Set<string>();
  for (const match of text.matchAll(/`([a-z0-9-]+\.spec\.ts)`/g)) {
    const spec = match[1];
    if (seenSpecs.has(spec)) continue;
    seenSpecs.add(spec);
    if (
      !existsSync(
        join(repoRoot, 'services', service, 'tests', 'e2e', 'specs', spec),
      )
    ) {
      findings.push(`DEAD spec \`${spec}\``);
    }
  }

  if (findings.length === 0) {
    console.log(`OK   ${guidePath}`);
    return 0;
  }
  console.log(`FAIL ${guidePath} (${findings.length} findings)`);
  for (const finding of findings) console.log(`  - ${finding}`);
  return findings.length;
}

const guides = process.argv.slice(2);
if (guides.length === 0) {
  console.error(
    'Usage: bun services/platform/tests/manual/scripts/check-guide.ts <guide.md> […]',
  );
  process.exit(2);
}
let total = 0;
for (const guide of guides) total += checkGuide(guide);
process.exit(total > 0 ? 1 : 0);
