import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 08 — drain the retired `workforce_digest` notification rows.
 *
 * The digest automation (and with it the only `workforce_digest` emitter) was
 * removed and the type's inbox i18n keys are gone, so surviving rows would
 * render raw keys in the bell. This migration deletes them. The
 * `v.literal('workforce_digest')` member stays in the `userNotifications`
 * type union ONE more release (the closed union validates existing rows at
 * schema push time — the same deploy-order constraint as adding a type, in
 * reverse); drop the literal once every deployment has run this. Contract
 * step (DESTRUCTIVE): each row is snapshotted into `migrationSnapshots`
 * before deletion, so `down` (the generic snapshot-restore) rebuilds it.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/08_delete_workforce_digest_notifications',
  semver: '0.2.90',
  numericId: 8,
  slug: 'delete_workforce_digest_notifications',
  title: 'Delete stored workforce_digest inbox notifications',
  description:
    'Deletes every userNotifications row with type workforce_digest (the ' +
    'digest automation and its i18n keys were removed; stale rows would ' +
    'render raw keys), after snapshotting each row. down restores the rows ' +
    'from the snapshot.',
  kind: 'db',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};
