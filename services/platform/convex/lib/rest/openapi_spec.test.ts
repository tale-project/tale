/**
 * The drift guard between `public/openapi.json` and the live route table.
 *
 * The spec is generated statically (`bun run generate:openapi`), so nothing
 * stops it from lying about the router except this test: every documented
 * path+method must resolve to a registered route, and every externally
 * documented route family (`/api/v1/*` plus the automation webhook) must be
 * documented. The predecessor spec carried 22 paths whose routes had been
 * deleted — exactly the failure mode asserted here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import http from '../../http';

const specPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../public/openapi.json',
);

interface Spec {
  paths: Record<string, Record<string, unknown>>;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generator wrote it
const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as Spec;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

/** `[path, method]` pairs from the router; prefix routes end in `/*`. */
const routes: Array<[string, string]> = http
  .getRoutes()
  .map(([path, method]) => [path, method]);

/** Spec entries as `[templatePath, METHOD]` pairs. */
const specEntries: Array<[string, string]> = Object.entries(spec.paths).flatMap(
  ([path, item]) =>
    Object.keys(item)
      .filter((k) => HTTP_METHODS.has(k))
      .map((m): [string, string] => [path, m.toUpperCase()]),
);

/** Does a registered route serve this spec path template? A `{param}`
 * template segment is satisfied by a `/*` prefix route. */
function routeServes(specPathTemplate: string, method: string): boolean {
  return routes.some(([routePath, routeMethod]) => {
    if (routeMethod !== method) return false;
    if (routePath.endsWith('/*')) {
      return specPathTemplate.startsWith(routePath.slice(0, -1));
    }
    return routePath === specPathTemplate;
  });
}

/** Is this registered route documented by at least one spec entry? */
function specCovers(routePath: string, method: string): boolean {
  return specEntries.some(([specPathTemplate, specMethod]) => {
    if (specMethod !== method) return false;
    if (routePath.endsWith('/*')) {
      return specPathTemplate.startsWith(routePath.slice(0, -1));
    }
    return specPathTemplate === routePath;
  });
}

/** The externally documented route families. Everything else on the router
 * (auth, SSO, SCIM, sandbox bridges, storage) is out of the public spec's
 * scope on purpose. */
function isDocumentedFamily(routePath: string): boolean {
  return (
    routePath.startsWith('/api/v1/') ||
    routePath.startsWith('/api/automations/webhook/')
  );
}

/** Documented routes the spec deliberately omits: the MCP GET exists only to
 * answer 405 (the endpoint is POST-only). */
const EXEMPT = new Set(['GET /api/v1/mcp']);

describe('openapi.json ↔ http router drift', () => {
  it('documents only paths a registered route serves', () => {
    const dead = specEntries.filter(
      ([path, method]) => !routeServes(path, method),
    );
    expect(dead).toEqual([]);
  });

  it('registers no undocumented /api/v1 or webhook route', () => {
    const undocumented = routes.filter(([path, method]) => {
      if (!isDocumentedFamily(path)) return false;
      if (method === 'OPTIONS') return false;
      if (EXEMPT.has(`${method} ${path}`)) return false;
      return !specCovers(path, method);
    });
    expect(undocumented).toEqual([]);
  });

  it('serves OPTIONS beside every documented /api/v1 resource', () => {
    const missingPreflight = specEntries
      .filter(([path]) => path.startsWith('/api/v1/'))
      .filter(([path]) => !routeServes(path, 'OPTIONS'))
      .map(([path]) => path);
    expect([...new Set(missingPreflight)]).toEqual([]);
  });
});
