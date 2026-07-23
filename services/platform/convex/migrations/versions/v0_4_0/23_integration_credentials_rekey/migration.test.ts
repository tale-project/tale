// @vitest-environment node

import { expect } from 'vitest';

import { encryptString } from '../../../../lib/crypto/encrypt_string';
import {
  decryptSecret,
  type EncryptedSecret,
} from '../../../../lib/secret_box';
import { buildModules } from '../../../framework/test_helpers';
import type {
  WorldHandle,
  WorldSeedCtx,
} from '../../../testing/harness.testkit';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import { isRetiredRow, toConnectorSlug, toStatus } from './migration';

const DIR = 'migrations/versions/v0_4_0/23_integration_credentials_rekey';
const MARKER = 'migration:0.4.0/23_integration_credentials_rekey';

// Plaintext behind the seeded JWE columns — the migration must land exactly
// these values inside the rebuilt envelopes.
const GITHUB_TOKEN = 'ghp_live_abcdef123456';
const MAILBOX_PASSWORD = 'mailbox-app-password-77';
const DRIVE_ACCESS_TOKEN = 'ya29.access-abcdef123456';
const DRIVE_REFRESH_TOKEN = '1//refresh-abcdef123456';

/** The rebuilt shape, as the test reads it back off the table. */
interface RebuiltRow {
  _id: string;
  organizationId: string;
  connectorSlug?: string;
  slug?: string;
  authMethod?: string;
  name?: string;
  encryptedData?: EncryptedSecret;
  maskedPreview?: string;
  isDefault?: boolean;
  status?: string;
  statusDetail?: string;
  createdBy?: string;
  createdAt?: number;
}

async function credentialRows(world: WorldHandle): Promise<RebuiltRow[]> {
  return await world.run(async (ctx) => {
    const rows = (await ctx.db
      .query('integrationCredentials')
      .collect()) as RebuiltRow[];
    return rows;
  });
}

function rowsOf(rows: readonly RebuiltRow[], organizationId: string) {
  return rows.filter((row) => row.organizationId === organizationId);
}

function byConnector(
  rows: readonly RebuiltRow[],
  connectorSlug: string,
): RebuiltRow {
  const row = rows.find((entry) => entry.connectorSlug === connectorSlug);
  expect(row, `expected a credential for "${connectorSlug}"`).toBeDefined();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the expect above guarantees presence
  return row as RebuiltRow;
}

/** The decrypted envelope of a rebuilt row. */
function envelopeOf(row: RebuiltRow): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every rebuilt row carries an envelope
  const parsed: unknown = JSON.parse(
    decryptSecret(row.encryptedData as EncryptedSecret),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the envelope is always a JSON document
  return parsed as Record<string, unknown>;
}

/** Insert one retired-shape row (the shape the world union still admits). */
async function seedRetiredRow(
  ctx: WorldSeedCtx,
  row: Record<string, unknown>,
): Promise<string> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seed ctx is untyped by design
  return (await ctx.db.insert('integrationCredentials', row)) as string;
}

// Harness ritual: real fleet up, handler idempotency over migrated state,
// down restoring the seeded world byte-for-byte (ORIGINAL JWE ciphertexts
// included, from the fs-tree sidecar), destructive gating, ledger coverage
// per org. Everything migration-specific is asserted in expectUp and the
// cases below.
defineMigrationTest({
  id: '0.4.0/23_integration_credentials_rekey',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 with NO credentials exercises the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    const [org1] = orgs;
    // api_key on a fixed-endpoint connector, carrying retired-only columns
    // (connection config, metadata) that only the snapshot can bring back.
    await seedRetiredRow(ctx, {
      organizationId: org1.id,
      slug: 'github',
      status: 'active',
      isActive: true,
      authMethod: 'api_key',
      apiKeyAuth: {
        keyEncrypted: await encryptString(GITHUB_TOKEN),
        keyPrefix: 'ghp_',
      },
      connectionConfig: { org: 'acme' },
      metadata: { installedBy: 'user_1' },
      lastSyncedAt: 1_700_000_000_000,
    });
    // basic_auth stored under smtpAuth (no basicAuth), inactive, and an
    // underscored slug — three retired quirks in one row.
    await seedRetiredRow(ctx, {
      organizationId: org1.id,
      slug: 'imap_smtp',
      status: 'inactive',
      isActive: false,
      authMethod: 'basic_auth',
      smtpAuth: {
        username: 'ops@example.com',
        passwordEncrypted: await encryptString(MAILBOX_PASSWORD),
      },
    });
    // An oauth2 grant the retired backend had flagged as errored.
    await seedRetiredRow(ctx, {
      organizationId: org1.id,
      slug: 'google_drive',
      status: 'error',
      isActive: true,
      authMethod: 'oauth2',
      errorMessage: 'token refresh failed',
      oauth2Auth: {
        accessTokenEncrypted: await encryptString(DRIVE_ACCESS_TOKEN),
        refreshTokenEncrypted: await encryptString(DRIVE_REFRESH_TOKEN),
        tokenExpiry: 1_700_000_500_000,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      },
    });
    // An installation that never stored a secret — must carry over, not
    // vanish.
    await seedRetiredRow(ctx, {
      organizationId: org1.id,
      slug: 'slack',
      status: 'active',
      isActive: true,
      authMethod: 'oauth2',
    });
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const all = await credentialRows(world);
    const rows = rowsOf(all, org1.id);

    expect(rows).toHaveLength(4);
    expect(rowsOf(all, org2.id)).toHaveLength(0);
    for (const row of rows) {
      expect(row.createdBy).toBe(MARKER);
      expect(row.name).toBe('Existing connection');
      // Every row of the retired table was the only one for its integration,
      // so every carried-over row is its connector's default.
      expect(row.isDefault).toBe(true);
      expect(typeof row.createdAt).toBe('number');
      // The rewrite REPLACES the document: no retired column survives.
      expect(Object.keys(row)).not.toContain('slug');
      expect(Object.keys(row)).not.toContain('isActive');
      expect(Object.keys(row)).not.toContain('apiKeyAuth');
      expect(Object.keys(row)).not.toContain('connectionConfig');
    }

    const github = byConnector(rows, 'github');
    expect(github.authMethod).toBe('api-key');
    expect(github.status).toBe('active');
    expect(github.maskedPreview).toBe('ghp_…56');
    expect(envelopeOf(github)).toEqual({ token: GITHUB_TOKEN });

    // Underscored slugs become the shipped connector directory names.
    const mailbox = byConnector(rows, 'imap-smtp');
    expect(mailbox.authMethod).toBe('basic');
    expect(mailbox.status).toBe('disabled');
    expect(mailbox.maskedPreview).toBe('mail…77');
    expect(envelopeOf(mailbox)).toEqual({
      username: 'ops@example.com',
      password: MAILBOX_PASSWORD,
    });

    const drive = byConnector(rows, 'google-drive');
    expect(drive.authMethod).toBe('oauth2');
    // A retired `error` row asks to be reconnected, and says why.
    expect(drive.status).toBe('needs-reauth');
    expect(drive.statusDetail).toBe('token refresh failed');
    expect(drive.maskedPreview).toBe('ya29…56');
    expect(envelopeOf(drive)).toEqual({
      accessToken: DRIVE_ACCESS_TOKEN,
      refreshToken: DRIVE_REFRESH_TOKEN,
      expiresAt: 1_700_000_500_000,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    // No secret to carry: the row survives as a reconnect prompt with an
    // empty envelope, never as a silently missing integration.
    const slack = byConnector(rows, 'slack');
    expect(slack.status).toBe('needs-reauth');
    expect(slack.statusDetail).toMatch(/re-enter it/);
    expect(slack.maskedPreview).toBeUndefined();
    expect(envelopeOf(slack)).toEqual({});
  },

  cases: {
    'a secret encrypted under a rotated key carries over for re-entry': async (
      world,
    ) => {
      const [org1] = world.orgs;
      await world.run(async (ctx) => {
        await seedRetiredRow(ctx, {
          organizationId: org1.id,
          slug: 'tavily',
          status: 'active',
          isActive: true,
          authMethod: 'api_key',
          // Not openable by the current key — what a rotated
          // ENCRYPTION_SECRET leaves behind.
          apiKeyAuth: { keyEncrypted: 'eyJhbGciOiJkaXIi.not.a.valid.jwe' },
        });
      });

      await world.applyUpOnly();
      const rows = rowsOf(await credentialRows(world), org1.id);
      const tavily = byConnector(rows, 'tavily');
      expect(tavily.status).toBe('needs-reauth');
      expect(tavily.statusDetail).toMatch(/re-enter it/);
      expect(envelopeOf(tavily)).toEqual({});
      // The other four rows still carried over normally.
      expect(rows).toHaveLength(5);
    },

    'a second row for one connector keeps ONE default and a distinct name':
      async (world) => {
        const [org1] = world.orgs;
        await world.run(async (ctx) => {
          await seedRetiredRow(ctx, {
            organizationId: org1.id,
            slug: 'github',
            status: 'active',
            isActive: true,
            authMethod: 'bearer_token',
            apiKeyAuth: { keyEncrypted: await encryptString(GITHUB_TOKEN) },
          });
        });

        await world.applyUpOnly();
        const github = rowsOf(await credentialRows(world), org1.id).filter(
          (row) => row.connectorSlug === 'github',
        );
        expect(github).toHaveLength(2);
        expect(github.filter((row) => row.isDefault === true)).toHaveLength(1);
        expect(
          github
            .map((row) => row.name ?? '')
            .sort((a, b) => a.localeCompare(b)),
        ).toEqual(['Existing connection', 'Existing connection (2)']);
        // A retired bearer token lived in the api-key column.
        const bearer = github.find((row) => row.authMethod === 'bearer');
        expect(envelopeOf(bearer as RebuiltRow)).toEqual({
          token: GITHUB_TOKEN,
        });
      },

    'a row whose integration cannot be named is left untouched for review':
      async (world) => {
        const [org1] = world.orgs;
        const strayId = await world.run(async (ctx) =>
          seedRetiredRow(ctx, {
            organizationId: org1.id,
            slug: '   ',
            status: 'active',
            isActive: true,
            authMethod: 'api_key',
          }),
        );

        await world.applyUpOnly();
        const stray = (await credentialRows(world)).find(
          (row) => row._id === strayId,
        );
        expect(stray?.slug).toBe('   ');
        expect(stray?.connectorSlug).toBeUndefined();
        expect(stray?.createdBy).toBeUndefined();
      },

    'down leaves nothing of the rebuilt shape behind': async (world) => {
      await world.applyUpOnly();
      await world.applyDownOnly();
      const rows = await credentialRows(world);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.connectorSlug).toBeUndefined();
        expect(row.createdBy).toBeUndefined();
        expect(row.slug).toBeDefined();
      }
      // The original ciphertexts are back, not re-encrypted equivalents.
      const github = rows.find((row) => row.slug === 'github');
      expect(github?.status).toBe('active');
    },
  },

  unit: {
    'retired slugs become the shipped connector directory names': () => {
      expect(toConnectorSlug('google_drive')).toBe('google-drive');
      expect(toConnectorSlug('imap_smtp')).toBe('imap-smtp');
      expect(toConnectorSlug(' github ')).toBe('github');
    },

    'the retired status pair collapses onto the rebuilt three states': () => {
      expect(toStatus('active', true).status).toBe('active');
      expect(toStatus('active', false).status).toBe('disabled');
      expect(toStatus('inactive', true).status).toBe('disabled');
      expect(toStatus('error', true).status).toBe('needs-reauth');
      const testing = toStatus('testing', true);
      expect(testing.status).toBe('disabled');
      expect(testing.detail).toMatch(/still being tested/);
    },

    'a rebuilt row is never mistaken for a retired one': () => {
      expect(isRetiredRow({ slug: 'github' })).toBe(true);
      expect(isRetiredRow({ connectorSlug: 'github' })).toBe(false);
      // Mid-flight safety: a row that somehow carries both is already
      // rebuilt and must not be rewritten again.
      expect(isRetiredRow({ slug: 'github', connectorSlug: 'github' })).toBe(
        false,
      );
      expect(isRetiredRow({})).toBe(false);
    },
  },
});
