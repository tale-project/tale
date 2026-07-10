import { describe, expect, it } from 'vitest';

import { buildOrderKey } from '../convex/migrations/framework/semver';
import type {
  MigrationKind,
  MigrationMeta,
} from '../convex/migrations/framework/types';
import {
  checkTableRowsFkSafety,
  generateNodeRegistry,
  generateRegistry,
  validateSet,
  type DiscoveredMigration,
} from './migrations-codegen';

function fixture(
  semver: string,
  numericId: number,
  slug: string,
  over: Partial<{
    kind: MigrationKind;
    legacy: boolean;
    destructive: boolean;
    snapshot: MigrationMeta['snapshot'];
    table: string;
  }> = {},
): DiscoveredMigration {
  const nn = String(numericId).padStart(2, '0');
  const folder = `${nn}_${slug}`;
  const id = `${semver}/${folder}`;
  const kind = over.kind ?? 'db';
  const meta: MigrationMeta = {
    id,
    semver,
    numericId,
    slug,
    title: `Test ${slug}`,
    description:
      'Synthetic fixture migration used to exercise the codegen validators without touching the real folder tree.',
    kind,
    reversible: true,
    destructive: over.destructive ?? false,
    snapshot: over.snapshot ?? 'none',
  };
  return {
    rel: `v${semver.replaceAll('.', '_')}/${folder}`,
    dir: `/virtual/${folder}`,
    semver,
    numericId,
    slug,
    id,
    orderKey: buildOrderKey(semver, numericId),
    kind,
    legacy: over.legacy ?? true,
    meta,
    table: over.table,
  };
}

describe('validateSet', () => {
  it('accepts a clean contiguous set', () => {
    const errors: string[] = [];
    validateSet(
      [
        fixture('0.2.85', 1, 'alpha'),
        fixture('0.2.85', 2, 'beta'),
        fixture('0.3.0', 1, 'gamma'),
      ],
      errors,
    );
    expect(errors).toEqual([]);
  });

  it('rejects an orderKey collision (the v0_2_90 defect class)', () => {
    const errors: string[] = [];
    validateSet(
      [fixture('0.2.90', 1, 'alpha'), fixture('0.2.90', 1, 'beta')],
      errors,
    );
    expect(errors.some((e) => e.includes('orderKey collision'))).toBe(true);
  });

  it('rejects a numericId gap inside a version folder', () => {
    const errors: string[] = [];
    validateSet(
      [fixture('0.2.90', 1, 'alpha'), fixture('0.2.90', 3, 'beta')],
      errors,
    );
    expect(errors.some((e) => e.includes('contiguously'))).toBe(true);
  });
});

describe('checkTableRowsFkSafety', () => {
  const schemaJson = JSON.stringify({
    tables: [
      {
        tableName: 'orders',
        documentType: {
          type: 'object',
          value: {
            contactId: {
              fieldType: { type: 'id', tableName: 'contacts' },
              optional: true,
            },
            lines: {
              fieldType: {
                type: 'array',
                value: {
                  type: 'object',
                  value: {
                    productId: {
                      fieldType: { type: 'id', tableName: 'products' },
                      optional: false,
                    },
                  },
                },
              },
              optional: false,
            },
          },
        },
      },
      { tableName: 'contacts', documentType: { type: 'object', value: {} } },
      { tableName: 'products', documentType: { type: 'object', value: {} } },
      { tableName: 'settings', documentType: { type: 'object', value: {} } },
    ],
  });

  it('rejects table-rows snapshots of _id-referenced tables, incl. nested refs', () => {
    const errors = checkTableRowsFkSafety(
      [
        fixture('0.4.0', 1, 'drop_contacts', {
          destructive: true,
          snapshot: 'table-rows',
          table: 'contacts',
        }),
        fixture('0.4.0', 2, 'drop_products', {
          destructive: true,
          snapshot: 'table-rows',
          table: 'products',
        }),
      ],
      schemaJson,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('orders.contactId');
    expect(errors[1]).toContain('drop_products');
  });

  it('allows table-rows snapshots of unreferenced tables and ignores other kinds', () => {
    const errors = checkTableRowsFkSafety(
      [
        fixture('0.4.0', 1, 'drop_settings', {
          destructive: true,
          snapshot: 'table-rows',
          table: 'settings',
        }),
        fixture('0.4.0', 2, 'fs_cleanup', {
          kind: 'node',
          destructive: true,
          snapshot: 'fs-tree',
        }),
        fixture('0.4.0', 3, 'plain_rename', { table: 'contacts' }),
      ],
      schemaJson,
    );
    expect(errors).toEqual([]);
  });
});

describe('generation', () => {
  const set = [
    fixture('0.2.85', 1, 'export_files', { kind: 'node' }),
    fixture('0.2.85', 2, 'split_rows', { legacy: true, table: 'rows' }),
    fixture('0.4.0', 1, 'new_shape', { legacy: false, table: 'rows' }),
    fixture('0.4.0', 2, 'new_node', { kind: 'node', legacy: false }),
    fixture('0.4.0', 3, 'documented', { kind: 'reference' }),
  ];

  it('is deterministic and routes shapes through the right composers', () => {
    const a = generateRegistry(set);
    expect(generateRegistry(set)).toBe(a);

    expect(a).toContain('"0.2.85/02_split_rows": composeLegacyDb(m0_2_85_02),');
    expect(a).toContain(
      '"0.4.0/01_new_shape": composeDb(requireMeta("0.4.0/01_new_shape"), m0_4_0_01),',
    );
    // Reference migrations contribute meta only — never a handler import.
    expect(a).not.toContain('03_documented/');
    expect(a).toContain('id: "0.4.0/03_documented"');

    const node = generateNodeRegistry(set);
    expect(node.startsWith("'use node';")).toBe(true);
    expect(node).toContain(
      '"0.2.85/01_export_files": composeLegacyNode(n0_2_85_01),',
    );
    expect(node).toContain(
      '"0.4.0/02_new_node": composeNode(requireMeta("0.4.0/02_new_node"), n0_4_0_02),',
    );
    // Node handler modules never leak into the V8 registry (meta literals do).
    expect(a).not.toContain("from '../versions/v0_2_85/01_export_files'");
    expect(a).toContain('id: "0.2.85/01_export_files"');
  });
});
