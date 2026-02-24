import type { DatabaseReader } from '../../_generated/server';

type OrgTable = 'customers' | 'documents' | 'products' | 'vendors' | 'websites';

export const DEFAULT_COUNT_CAP = 20;

export async function countItemsInOrg(
  db: DatabaseReader,
  table: OrgTable,
  organizationId: string,
  cap = DEFAULT_COUNT_CAP,
): Promise<number> {
  let count = 0;
  for await (const _ of db
    .query(table)
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )) {
    count++;
    if (count >= cap) break;
  }
  return count;
}
