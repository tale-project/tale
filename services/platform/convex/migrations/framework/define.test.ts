import { describe, expect, it } from 'vitest';

import {
  defineComponentMigration,
  defineDbMigration,
  defineNodeMigration,
  defineReferenceMigration,
  type ComponentMigrationSpec,
  type DbMigrationSpec,
  type NodeMigrationSpec,
  type ReferenceMigrationSpec,
} from './define';

const DESCRIPTION =
  'Copies every widget row into the gadgets table; down deletes the copies ' +
  'and leaves the widgets untouched. Idempotent in both directions.';

function dbSpec(over: Partial<DbMigrationSpec> = {}): DbMigrationSpec {
  return {
    title: 'Backfill gadgets from widgets',
    description: DESCRIPTION,
    destructive: false,
    snapshot: 'none',
    subjects: { tables: ['widgets', 'gadgets'] },
    table: 'widgets',
    async up() {},
    async down() {},
    ...over,
  };
}

function nodeSpec(over: Partial<NodeMigrationSpec> = {}): NodeMigrationSpec {
  return {
    title: 'Rewrite branding accent color',
    description: DESCRIPTION,
    destructive: false,
    snapshot: 'none',
    subjects: { domains: ['branding'] },
    async up() {},
    async down() {},
    ...over,
  };
}

function componentSpec(
  over: Partial<ComponentMigrationSpec> = {},
): ComponentMigrationSpec {
  return {
    title: 'Normalize auth user emails',
    description: DESCRIPTION,
    destructive: false,
    snapshot: 'none',
    subjects: { tables: ['betterAuth:user'] },
    async up() {
      return {
        isDone: true,
        processed: 0,
        renamed: 0,
        merged: 0,
        skipped: 0,
        noop: 0,
        continueCursor: null,
      };
    },
    async down() {
      return {
        isDone: true,
        processed: 0,
        renamed: 0,
        merged: 0,
        skipped: 0,
        noop: 0,
        continueCursor: null,
      };
    },
    ...over,
  };
}

function referenceSpec(
  over: Partial<ReferenceMigrationSpec> = {},
): ReferenceMigrationSpec {
  return {
    title: 'Rename agentFileName to agentSlug',
    description: DESCRIPTION,
    destructive: false,
    snapshot: 'none',
    table: 'agentBindings',
    async up() {},
    async down() {},
    ...over,
  };
}

describe('define factories', () => {
  it('tags the module with its kind and passes the spec through', () => {
    const db = defineDbMigration(dbSpec());
    expect(db.kind).toBe('db');
    expect(db.spec.table).toBe('widgets');

    expect(defineNodeMigration(nodeSpec()).kind).toBe('node');
    expect(defineComponentMigration(componentSpec()).kind).toBe('component');
    expect(defineReferenceMigration(referenceSpec()).kind).toBe('reference');
  });

  it('rejects empty and oversized titles', () => {
    expect(() => defineDbMigration(dbSpec({ title: '' }))).toThrow(/title/);
    expect(() => defineDbMigration(dbSpec({ title: 'x'.repeat(101) }))).toThrow(
      /title/,
    );
  });

  it('rejects descriptions too short to explain up and down', () => {
    expect(() =>
      defineDbMigration(dbSpec({ description: 'renames a field' })),
    ).toThrow(/description/);
  });

  it('rejects a destructive runnable migration without a snapshot strategy', () => {
    expect(() =>
      defineDbMigration(dbSpec({ destructive: true, snapshot: 'none' })),
    ).toThrow(/snapshot/);
    expect(() =>
      defineNodeMigration(nodeSpec({ destructive: true, snapshot: 'none' })),
    ).toThrow(/snapshot/);
    expect(() =>
      defineComponentMigration(
        componentSpec({ destructive: true, snapshot: 'none' }),
      ),
    ).toThrow(/snapshot/);
    // Accepted with a strategy declared.
    expect(
      defineDbMigration(dbSpec({ destructive: true, snapshot: 'table-rows' }))
        .spec.destructive,
    ).toBe(true);
  });

  it('rejects out-of-range batch sizes', () => {
    expect(() => defineDbMigration(dbSpec({ batchSize: 0 }))).toThrow(
      /batchSize/,
    );
    expect(() => defineDbMigration(dbSpec({ batchSize: 1001 }))).toThrow(
      /batchSize/,
    );
    expect(() => defineDbMigration(dbSpec({ batchSize: 2.5 }))).toThrow(
      /batchSize/,
    );
    expect(
      defineComponentMigration(componentSpec({ batchSize: 50 })).spec.batchSize,
    ).toBe(50);
  });

  it('requires subjects on runnable kinds so the world corpus can cover them', () => {
    expect(() => defineDbMigration(dbSpec({ subjects: undefined }))).toThrow(
      /subjects/,
    );
    expect(() =>
      defineNodeMigration(nodeSpec({ subjects: { domains: [] } })),
    ).toThrow(/subjects/);
  });

  it('exempts reference migrations from runnable-only rules', () => {
    // Documented history: may be destructive with snapshot none, no subjects.
    const ref = defineReferenceMigration(
      referenceSpec({ destructive: true, snapshot: 'none' }),
    );
    expect(ref.spec.destructive).toBe(true);
  });

  it('requires a table on db and reference kinds', () => {
    expect(() => defineDbMigration(dbSpec({ table: '' }))).toThrow(/table/);
    expect(() =>
      defineReferenceMigration(referenceSpec({ table: '' })),
    ).toThrow(/table/);
  });
});
