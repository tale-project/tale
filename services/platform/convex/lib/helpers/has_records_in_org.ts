import type { DatabaseReader } from '../../_generated/server';

type OrgTable = 'customers' | 'conversations' | 'products' | 'vendors' | 'websites';

export async function hasRecordsInOrg(
  db: DatabaseReader,
  table: OrgTable,
  organizationId: string,
): Promise<boolean> {
  switch (table) {
    case 'customers': {
      const r = await db.query('customers').withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId)).first();
      return r !== null;
    }
    case 'conversations': {
      const r = await db.query('conversations').withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId)).first();
      return r !== null;
    }
    case 'products': {
      const r = await db.query('products').withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId)).first();
      return r !== null;
    }
    case 'vendors': {
      const r = await db.query('vendors').withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId)).first();
      return r !== null;
    }
    case 'websites': {
      const r = await db.query('websites').withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId)).first();
      return r !== null;
    }
  }
}
