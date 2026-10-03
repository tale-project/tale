// @vitest-environment node

/**
 * The retention bounds and policy every new organization is seeded with:
 * the builtin catalog (`configs/platform/custom/governance/`) and the
 * docs-screenshot stack's own catalog (`tests/e2e/fixtures/config/docs-demo`).
 *
 * The scaffolder copies a bounds file without checking it, and an
 * organization whose bounds file does not parse has no bounds at all: the
 * editor renders none and every save is refused `RETENTION_CONFIG_MISSING`.
 * A retired category left in a copy breaks it that way, silently. So each
 * shipped bounds file must satisfy the schema and declare every category
 * (the bounds walk throws on a gap), the shipped policy must sit inside the
 * bounds it ships with, and an admin must be able to keep audit logs for
 * 180 days.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { retentionPolicyConfigSchema } from '@tale/shared/schemas/governance';
import { describe, expect, it } from 'vitest';

import { parseYaml } from '../../../lib/shared/config/yaml';
import {
  RETENTION_CATEGORIES,
  retentionDefaultsConfigSchema,
} from '../../../lib/shared/schemas/retention';
import {
  assertWithinBounds,
  buildBoundsByCategory,
  RETENTION_POLICY_FIELD_BY_CATEGORY,
} from './retention_floors';

const PLATFORM_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../..',
);

const CATALOGS = [
  {
    name: 'builtin catalog',
    dir: path.join(PLATFORM_DIR, '../../configs/platform/custom/governance'),
    bounds: 'retention.yml',
    policy: 'retention-policy.yml',
  },
  {
    name: 'docs-screenshot catalog',
    dir: path.join(
      PLATFORM_DIR,
      'tests/e2e/fixtures/config/docs-demo/governance',
    ),
    bounds: 'retention.json',
    policy: 'retention-policy.json',
  },
] as const;

type Catalog = (typeof CATALOGS)[number];

function readCatalogFile(catalog: Catalog, fileName: string): unknown {
  const text = readFileSync(path.join(catalog.dir, fileName), 'utf8');
  if (fileName.endsWith('.json')) return JSON.parse(text);
  const parsed = parseYaml(text);
  if (!parsed.ok) throw new Error(`${fileName}: ${parsed.error}`);
  return parsed.data;
}

function boundsOf(catalog: Catalog) {
  return buildBoundsByCategory(
    retentionDefaultsConfigSchema.parse(
      readCatalogFile(catalog, catalog.bounds),
    ),
  );
}

describe.each(CATALOGS)('shipped retention bounds: $name', (catalog) => {
  it('satisfies the schema and declares every category', () => {
    const config = retentionDefaultsConfigSchema.parse(
      readCatalogFile(catalog, catalog.bounds),
    );
    for (const category of RETENTION_CATEGORIES) {
      expect(config[category], category).toBeDefined();
    }
  });

  it('lets an admin keep audit logs for 180 days', () => {
    expect(() =>
      assertWithinBounds(boundsOf(catalog).auditLog, 180),
    ).not.toThrow();
  });

  it('seeds a policy its own bounds admit', () => {
    const bounds = boundsOf(catalog);
    const policy = retentionPolicyConfigSchema.parse(
      readCatalogFile(catalog, catalog.policy),
    );
    const seeded = RETENTION_CATEGORIES.flatMap((category) => {
      const value = policy[RETENTION_POLICY_FIELD_BY_CATEGORY[category]];
      return typeof value === 'number' ? [{ category, value }] : [];
    });
    // A policy that seeds no value would pass the loop below vacuously.
    expect(seeded.length).toBeGreaterThan(0);
    for (const { category, value } of seeded) {
      expect(
        () => assertWithinBounds(bounds[category], value),
        category,
      ).not.toThrow();
    }
  });
});
