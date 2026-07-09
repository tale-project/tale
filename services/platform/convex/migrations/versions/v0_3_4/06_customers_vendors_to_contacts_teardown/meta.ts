import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 06 — teardown of the Customers + Vendors → Contacts merge (issue
 * #2618). Records the schema-shape removals that land with this release:
 *  - the `customers` and `vendors` tables are dropped (their rows were copied
 *    into `contacts` by 0.3.4/02 + 0.3.4/03),
 *  - `conversations.customerId` and `supportCases.customerId` are dropped
 *    (repointed to `contactId` by 0.3.4/04 + 0.3.4/05),
 *  - the customer-only `status` field goes with the `customers` table.
 *
 * Convex validates existing rows against the new schema at push time, so these
 * field/table removals cannot be deferred to a post-deploy migration — hence
 * `reference` (the runner never executes it). The forward/inverse transform in
 * index.ts documents the representative field-level change (`conversations`
 * losing `customerId`) and is round-trip tested. `down` is a structural
 * reversal only: the original `customerId` is unrecoverable (the `customers`
 * table is gone; `contactId` is its forward replacement).
 */
export const meta: MigrationMeta = {
  id: '0.3.4/06_customers_vendors_to_contacts_teardown',
  semver: '0.3.4',
  numericId: 6,
  slug: 'customers_vendors_to_contacts_teardown',
  title:
    'Drop customers + vendors tables and conversation/support-case customerId',
  description:
    'Teardown of the customers+vendors → contacts merge (#2618): drops the ' +
    'customers and vendors tables (rows copied to contacts by 02/03) and the ' +
    'customerId link on conversations/supportCases (repointed to contactId by ' +
    '04/05); the customer-only status field goes with the customers table. up ' +
    'unsets customerId; down structurally restores it (original value ' +
    'unrecoverable — contactId is the forward replacement).',
  kind: 'reference',
  reversible: true,
  destructive: true,
  snapshot: 'none',
};
