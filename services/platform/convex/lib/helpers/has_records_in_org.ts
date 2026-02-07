import type { DatabaseReader } from '../../_generated/server';

type OrgTable = 'customers' | 'conversations' | 'products' | 'vendors' | 'websites';

export async function hasRecordsInOrg(
  db: DatabaseReader,
  table: OrgTable,
  organizationId: string,
): Promise<boolean> {
  const record = await db
    .query(table)
    .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
    .first();
  return record !== null;
}
