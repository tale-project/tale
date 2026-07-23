'use node';

/**
 * 0.4.0 / 23 — carry the retired integration credentials into the rebuilt
 * `integrationCredentials` shape.
 *
 * The retired table held ONE row per (organization, integration), with the
 * secret material spread over per-method columns (`apiKeyAuth.keyEncrypted`,
 * `basicAuth.passwordEncrypted` / `smtpAuth`, `oauth2Auth.*`) each holding a
 * compact JWE, plus a pile of operational bookkeeping (sync stats, icons,
 * connection config). The rebuilt table holds MANY rows per connector, one
 * `encryptedData` envelope per row (AES-256-GCM via `lib/secret_box`), a
 * name, and a default flag. `up` rewrites each row IN PLACE — same document
 * id, so anything pointing at a credential keeps pointing at it:
 *
 *  - `slug` → `connectorSlug`, underscores becoming dashes to match the
 *    shipped connector directories (`google_drive` → `google-drive`,
 *    `imap_smtp` → `imap-smtp`);
 *  - `authMethod` `api_key`/`bearer_token`/`basic_auth`/`oauth2` →
 *    `api-key`/`bearer`/`basic`/`oauth2`;
 *  - every per-column JWE is opened with the primitive that wrote it
 *    (`lib/crypto/decrypt_string`) and re-sealed as ONE JSON envelope in the
 *    shape the method now stores, with a fresh non-secret preview;
 *  - the old `status` + `isActive` pair collapses onto the new three states:
 *    inactive/testing → `disabled`, `error` → `needs-reauth`, everything
 *    else → `active`;
 *  - the first row of each (organization, connector) becomes its default,
 *    which is exactly what the old one-row-per-integration rule meant;
 *  - `createdBy` becomes `migration:<id>`, `createdAt` keeps the document's
 *    own creation time.
 *
 * A row whose secret cannot be produced — none stored, or a JWE the current
 * `ENCRYPTION_SECRET*` cannot open (a key rotation since it was written) —
 * is NEVER dropped: it carries over with an empty envelope,
 * `status: 'needs-reauth'` and a `statusDetail` saying the secret must be
 * re-entered. Resolution refuses such a row by status before anything tries
 * to open the envelope, so the operator gets a reconnect prompt instead of a
 * silently missing integration.
 *
 * DESTRUCTIVE: the retired columns have nowhere to live in the new shape, so
 * `up` first writes every original document verbatim into a per-org sidecar
 * (`.integration-credentials-carryover/rows.json`) and captures it with the
 * fs-tree snapshot — the same device `0.3.4/11` uses to carry DB-derived
 * state through one snapshot call. `down` restores the sidecar and writes
 * each original back onto its own document id: byte-for-byte, ORIGINAL
 * ciphertexts included, which re-encrypting could never be. Both directions
 * are idempotent — `up` skips rows already in the rebuilt shape and never
 * re-captures once rows are carried over, `down` re-writes identical
 * documents.
 */

import path from 'node:path';

import { getString, isRecord } from '../../../../../lib/utils/type-utils';
import { internal } from '../../../../_generated/api';
import {
  parseSecretPayload,
  SecretPayloadError,
  type IntegrationSecretPayload,
} from '../../../../integration_credentials/auth_injection';
import { maskPayload } from '../../../../integration_credentials/masking';
import { decryptString } from '../../../../lib/crypto/decrypt_string';
import { getConfigRoot, validateOrgSlug } from '../../../../lib/file_io';
import { encryptSecret } from '../../../../lib/secret_box';
import type { BoundNodeHelpers } from '../../../framework/define';
import { defineNodeMigration } from '../../../framework/define';
import type { MigrationOrg, NodeMigrationCtx } from '../../../framework/types';

/** Sidecar directory (per org) the fs-tree snapshot captures. Written and
 * removed inside the same handler, so it never lingers in the config tree;
 * the dot prefix keeps the domain readers from ever enumerating it. */
const CARRYOVER_DIR = '.integration-credentials-carryover';
const ROWS_FILE = 'rows.json';

/** The label every carried-over row gets — the retired table allowed one row
 * per integration, so an organization sees exactly one per connector. */
const CARRIED_NAME = 'Existing connection';

type NewAuthMethod = 'api-key' | 'bearer' | 'basic' | 'oauth2';

/** Retired `authMethod` spelling → the rebuilt one. */
const AUTH_METHOD_MAP: Readonly<Record<string, NewAuthMethod>> = {
  api_key: 'api-key',
  bearer_token: 'bearer',
  basic_auth: 'basic',
  oauth2: 'oauth2',
};

/** One row as the sidecar records it: its document id plus the original
 * document with the system fields stripped (a restore writes onto the same
 * id, which carries `_creationTime` with it). */
interface CapturedRow {
  readonly id: string;
  readonly document: Record<string, unknown>;
}

function resolveCarryoverDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot('integration credentials'),
    orgSlug,
    CARRYOVER_DIR,
  );
}

/** A row still in the retired shape — the rebuilt one always has a
 * `connectorSlug`, the retired one never did. */
export function isRetiredRow(row: Record<string, unknown>): boolean {
  return (
    getString(row, 'connectorSlug') === undefined &&
    getString(row, 'slug') !== undefined
  );
}

/**
 * Retired integration slug → shipped connector directory. The rebuilt
 * catalog is kebab-case throughout (`google_drive` → `google-drive`,
 * `imap_smtp` → `imap-smtp`), so the rename is mechanical.
 */
export function toConnectorSlug(slug: string): string {
  return slug.trim().replaceAll('_', '-');
}

/** The rebuilt status for a retired (status, isActive) pair. */
export function toStatus(
  status: string | undefined,
  isActive: boolean | undefined,
): { status: 'active' | 'disabled' | 'needs-reauth'; detail?: string } {
  // The retired `error` state was recorded when a connection test failed —
  // re-entering the credential is what clears it, which is exactly what
  // `needs-reauth` asks for.
  if (status === 'error') return { status: 'needs-reauth' };
  if (status === 'testing') {
    return {
      status: 'disabled',
      detail: 'The connection was still being tested when it was carried over.',
    };
  }
  if (status === 'inactive' || isActive === false) {
    return { status: 'disabled' };
  }
  return { status: 'active' };
}

/** Decrypt one stored compact JWE, or null when it is absent or unopenable. */
async function openJwe(
  jwe: string | undefined,
  label: string,
): Promise<string | null> {
  if (jwe === undefined || jwe === '') return null;
  try {
    return await decryptString(jwe);
  } catch (err) {
    console.warn(
      `[integration-credentials-migration] ${label}: stored secret could not be decrypted (most likely an ENCRYPTION_SECRET rotation since it was saved); carrying the row over for re-entry:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * The rebuilt payload for one retired row, or null when its secret is not
 * recoverable. Reads the column the retired backend actually wrote for each
 * method: bearer tokens shared the api-key column, and an IMAP/SMTP login
 * fell back to `smtpAuth` when `basicAuth` was absent.
 */
async function buildPayload(
  authMethod: NewAuthMethod,
  row: Record<string, unknown>,
  label: string,
): Promise<IntegrationSecretPayload | null> {
  const document = await (async (): Promise<Record<string, unknown> | null> => {
    switch (authMethod) {
      case 'api-key':
      case 'bearer': {
        const auth = row.apiKeyAuth;
        if (!isRecord(auth)) return null;
        const token = await openJwe(getString(auth, 'keyEncrypted'), label);
        return token === null ? null : { token };
      }
      case 'basic': {
        const auth = isRecord(row.basicAuth)
          ? row.basicAuth
          : isRecord(row.smtpAuth)
            ? row.smtpAuth
            : null;
        if (auth === null) return null;
        const username = getString(auth, 'username');
        const password = await openJwe(
          getString(auth, 'passwordEncrypted'),
          label,
        );
        return username === undefined || password === null
          ? null
          : { username, password };
      }
      case 'oauth2': {
        const auth = row.oauth2Auth;
        if (!isRecord(auth)) return null;
        const accessToken = await openJwe(
          getString(auth, 'accessTokenEncrypted'),
          label,
        );
        if (accessToken === null) return null;
        const refreshToken = await openJwe(
          getString(auth, 'refreshTokenEncrypted'),
          `${label} (refresh token)`,
        );
        const expiresAt = auth.tokenExpiry;
        const scopes = auth.scopes;
        return {
          accessToken,
          ...(refreshToken !== null && { refreshToken }),
          ...(typeof expiresAt === 'number' && { expiresAt }),
          ...(Array.isArray(scopes) && { scopes }),
        };
      }
      default: {
        const _exhaustive: never = authMethod;
        return _exhaustive;
      }
    }
  })();
  if (document === null) return null;
  try {
    return parseSecretPayload(authMethod, document);
  } catch (err) {
    if (err instanceof SecretPayloadError) {
      console.warn(
        `[integration-credentials-migration] ${label}: stored secret does not fit the ${authMethod} shape; carrying the row over for re-entry:`,
        err.message,
      );
      return null;
    }
    throw err;
  }
}

/** The stored envelope is untagged — the row's `authMethod` says which shape
 * it is (see `integration_credentials/schema.ts`). */
function envelopeDocument(
  payload: IntegrationSecretPayload | null,
): Record<string, unknown> {
  if (payload === null) return {};
  const { authMethod: _method, ...document } = payload;
  return document;
}

/** Read this org's rows through the migration's own internal query. */
async function listRows(
  ctx: NodeMigrationCtx,
  org: MigrationOrg,
): Promise<Array<Record<string, unknown> & { _id: string }>> {
  return (await ctx.runQuery(
    internal.migrations.versions.v0_4_0['23_integration_credentials_rekey']
      .rekey_rows.listOrgRowsInternal,
    { organizationId: org.id },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns whole documents as v.any()
  )) as Array<Record<string, unknown> & { _id: string }>;
}

/** Write the org's original documents into the sidecar and capture it. */
async function captureRows(
  helpers: BoundNodeHelpers,
  dir: string,
  rows: ReadonlyArray<Record<string, unknown> & { _id: string }>,
): Promise<void> {
  const captured: CapturedRow[] = rows.map((row) => {
    const { _id, _creationTime: _bornAt, ...document } = row;
    return { id: _id, document };
  });
  await helpers.atomicWrite(
    path.join(dir, ROWS_FILE),
    `${JSON.stringify(captured, null, 2)}\n`,
  );
  await helpers.snapshotFsTree(dir);
  await helpers.removeDirSafe(dir);
}

export const migration = defineNodeMigration({
  title: 'Carry retired integration credentials into the rebuilt shape',
  description:
    'Rewrites every retired integrationCredentials row in place: slug and ' +
    'auth method re-spelled for the shipped connectors, the per-column JWE ' +
    'secrets re-encrypted into one secret_box envelope with a masked ' +
    'preview, status collapsed onto active/disabled/needs-reauth, and the ' +
    'first row per (org, connector) marked default. A row whose secret ' +
    'cannot be decrypted carries over as needs-reauth instead of being ' +
    'dropped. down restores each original document byte-for-byte from the ' +
    'per-org fs-tree snapshot captured before the rewrite.',
  destructive: true,
  snapshot: 'fs-tree',
  subjects: { tables: ['integrationCredentials'] },

  async up(ctx, org, helpers) {
    const marker = `migration:${helpers.migrationId}`;
    const rows = await listRows(ctx, org);
    const retired = rows.filter(isRetiredRow);

    // Capture BEFORE the first rewrite, and only while nothing is rewritten
    // yet: a resumed run finds its own rows already carried over and must
    // keep the capture that still holds every original.
    const resuming = rows.some((row) => getString(row, 'createdBy') === marker);
    if (!resuming) {
      await captureRows(helpers, resolveCarryoverDir(org.slug), retired);
    }
    if (retired.length === 0) return;

    // The retired table allowed one row per (org, slug); a duplicate that
    // slipped past that code-level rule still gets a unique name here, and
    // only the first of a pair keeps the default.
    const seenPerConnector = new Map<string, number>();
    for (const row of retired) {
      const slug = getString(row, 'slug') ?? '';
      const connectorSlug = toConnectorSlug(slug);
      const retiredMethod = getString(row, 'authMethod') ?? '';
      const authMethod = AUTH_METHOD_MAP[retiredMethod];
      if (connectorSlug === '' || authMethod === undefined) {
        console.warn(
          `[integration-credentials-migration] ${org.slug}: row ${row._id} names integration "${slug}" with auth method "${retiredMethod}", which has no counterpart; leaving it untouched for manual review.`,
        );
        continue;
      }

      const label = `${org.slug}/${slug}`;
      const payload = await buildPayload(authMethod, row, label);
      const mapped = toStatus(
        getString(row, 'status'),
        typeof row.isActive === 'boolean' ? row.isActive : undefined,
      );
      const preview = payload === null ? undefined : maskPayload(payload);
      const detail =
        payload === null
          ? 'The stored secret could not be carried over — re-enter it to reconnect this integration.'
          : (mapped.detail ?? getString(row, 'errorMessage'));

      const seen = seenPerConnector.get(connectorSlug) ?? 0;
      seenPerConnector.set(connectorSlug, seen + 1);
      // Both timestamps come from the row being carried over, never the wall
      // clock: the rebuilt row is written exactly once, from a source that
      // already exists, so re-running the chain must reproduce it byte for
      // byte. A `Date.now()` here would make two independent `up` runs
      // disagree even though they carried identical data.
      const carriedAt =
        typeof row._creationTime === 'number' ? row._creationTime : 0;
      await ctx.runMutation(
        internal.migrations.versions.v0_4_0['23_integration_credentials_rekey']
          .rekey_rows.writeRekeyedRowInternal,
        {
          credentialId: row._id,
          organizationId: org.id,
          connectorSlug,
          authMethod,
          name: seen === 0 ? CARRIED_NAME : `${CARRIED_NAME} (${seen + 1})`,
          // A row with no recoverable secret still needs an envelope: the
          // shape requires one, and its status keeps resolution from ever
          // opening it.
          encryptedData: encryptSecret(
            JSON.stringify(envelopeDocument(payload)),
          ),
          ...(preview !== undefined && { maskedPreview: preview }),
          isDefault: seen === 0,
          status: payload === null ? 'needs-reauth' : mapped.status,
          ...(detail !== undefined && { statusDetail: detail }),
          createdBy: marker,
          createdAt: carriedAt,
          updatedAt: carriedAt,
        },
      );
    }
  },

  async down(ctx, org, helpers) {
    const marker = `migration:${helpers.migrationId}`;
    const dir = resolveCarryoverDir(org.slug);
    await helpers.restoreFsTree(dir);
    const raw = await helpers.readFileSafe(path.join(dir, ROWS_FILE));
    await helpers.removeDirSafe(dir);
    if (raw === null) return;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sidecar is written by this migration's own up
    const captured = JSON.parse(raw) as CapturedRow[];
    const restoredIds = new Set<string>();
    for (const entry of captured) {
      await ctx.runMutation(
        internal.migrations.versions.v0_4_0['23_integration_credentials_rekey']
          .rekey_rows.restoreRetiredRowInternal,
        { credentialId: entry.id, document: entry.document },
      );
      restoredIds.add(entry.id);
    }

    // Anything still carrying the marker has no original behind it — the
    // inverse of a write this migration made is its removal.
    for (const row of await listRows(ctx, org)) {
      if (getString(row, 'createdBy') !== marker) continue;
      if (restoredIds.has(row._id)) continue;
      console.warn(
        `[integration-credentials-migration] ${org.slug}: row ${row._id} carries the migration marker but is absent from the snapshot; removing it.`,
      );
      await ctx.runMutation(
        internal.migrations.versions.v0_4_0['23_integration_credentials_rekey']
          .rekey_rows.deleteRowInternal,
        { credentialId: row._id },
      );
    }
  },
});
