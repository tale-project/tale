import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { integrationJsonSchema } from './integrations';

/**
 * Every integration `config.json` in `examples/default/integrations/` ships as
 * part of the product — new orgs seed their integration catalog by copying these
 * files, and a connected credential drives the bundle-provision + disconnect
 * cascade off this exact shape. If an example drifts into an invalid shape, or a
 * `bundles` entry names an agent/workflow that doesn't exist, the failure is
 * SILENT at runtime: `provisionIntegrationBundle` skips an unreadable agent
 * (`readAgentBySlug` → not ok → `continue`) and a missing workflow slug, so the
 * promised company-of-agents bundle never installs and no error surfaces. Pin
 * both the schema and the cross-references in CI so the break is loud here.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const INTEGRATIONS_DIR = path.join(REPO_ROOT, 'examples/default/integrations');
const AGENTS_DIR = path.join(REPO_ROOT, 'examples/default/agents');
const WORKFLOWS_DIR = path.join(REPO_ROOT, 'examples/default/workflows');

/** Directories holding an integration (those with a `config.json`). */
function integrationSlugs(): string[] {
  return readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/** Recursively collect every `.json` file under `dir` as a repo-relative slug-ish path. */
function walkJson(dir: string, rootDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJson(full, rootDir));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(path.relative(rootDir, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * The set of agent slugs the bundle cascade can resolve. Mirrors the runtime's
 * `effectiveAgentSlug`: the explicit `config.slug` when present, else the file
 * basename. Agent slugs are single-level (no folder prefix — the slug regex
 * forbids `/`), so bundle refs must NOT be folder-qualified.
 */
function resolvableAgentSlugs(): Set<string> {
  const slugs = new Set<string>();
  for (const rel of walkJson(AGENTS_DIR, AGENTS_DIR)) {
    const cfg = readJson(path.join(AGENTS_DIR, rel));
    const explicit =
      cfg && typeof cfg === 'object' && 'slug' in cfg
        ? (cfg as { slug?: unknown }).slug
        : undefined;
    const slug =
      typeof explicit === 'string' && explicit.length > 0
        ? explicit
        : path.basename(rel, '.json');
    slugs.add(slug);
  }
  return slugs;
}

/**
 * The set of workflow slugs the bundle cascade can resolve. Mirrors the
 * runtime's `workflowSlugFromRelativePath`: the relative path without the
 * `.json` extension (path-based, so folder-qualified — e.g.
 * `github/review-pull-request-in-github`).
 */
function resolvableWorkflowSlugs(): Set<string> {
  return new Set(
    walkJson(WORKFLOWS_DIR, WORKFLOWS_DIR).map((rel) =>
      rel.replace(/\.json$/, ''),
    ),
  );
}

describe('examples/default/integrations/*/config.json invariants', () => {
  const slugs = integrationSlugs();

  it('discovered at least one default integration', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  for (const slug of slugs) {
    describe(slug, () => {
      const parsed = integrationJsonSchema.safeParse(
        readJson(path.join(INTEGRATIONS_DIR, slug, 'config.json')),
      );

      it('parses against integrationJsonSchema', () => {
        if (!parsed.success) {
          throw new Error(
            `${slug}/config.json failed schema: ${parsed.error.message}`,
          );
        }
        expect(parsed.success).toBe(true);
      });

      it('has a concise one-line description', () => {
        if (!parsed.success) throw new Error('schema parse failed');
        // The catalog renders the description as a single action line; a
        // newline breaks that layout (the icon convention is enforced by the
        // 24x24 white tile, but description shape lives here).
        const description = parsed.data.description;
        if (description !== undefined) {
          expect(description).not.toContain('\n');
          expect(description.trim().length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('integration bundle references resolve to real files', () => {
  const agentSlugs = resolvableAgentSlugs();
  const workflowSlugs = resolvableWorkflowSlugs();

  for (const slug of integrationSlugs()) {
    const parsed = integrationJsonSchema.safeParse(
      readJson(path.join(INTEGRATIONS_DIR, slug, 'config.json')),
    );
    const bundles = parsed.success ? parsed.data.bundles : undefined;
    if (!bundles) continue;

    describe(`${slug} bundles`, () => {
      it('every bundled agent slug resolves to an agent file', () => {
        for (const agentSlug of bundles.agents ?? []) {
          // A folder-qualified ref (containing `/`) can never match a real
          // single-level agent slug — catch that mistake explicitly.
          expect(
            agentSlug.includes('/'),
            `${slug} bundles agent "${agentSlug}" with a folder prefix; agent slugs are single-level`,
          ).toBe(false);
          expect(
            agentSlugs.has(agentSlug),
            `${slug} bundles unknown agent "${agentSlug}"`,
          ).toBe(true);
        }
      });

      it('every bundled workflow slug resolves to a workflow file', () => {
        for (const workflowSlug of bundles.workflows ?? []) {
          expect(
            workflowSlugs.has(workflowSlug),
            `${slug} bundles unknown workflow "${workflowSlug}"`,
          ).toBe(true);
        }
      });
    });
  }
});
