/**
 * The one `resolveCredentialRefInternal` answer both reused resolvers read —
 * the work-lane credential broker and the mailbox sync's IMAP fromAddress
 * heal. It must carry the sealed envelope (the reused resolver decrypts it
 * itself) in the 0.4 wire shape: nullable columns absent, never null. The
 * conversations shim used to serve an identity-only answer, so the heal died
 * on the missing envelope every pass before it could heal anything.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { resolveCredentialRowForShim } from './service.ts';

/** A `sql` stand-in answering the connector's row listing with `rows`. */
function fakeSql(rows: unknown[]): Sql {
  const tag = (..._args: unknown[]) => Promise.resolve(rows);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

const ROW = {
  id: 'cred_1',
  organizationId: 'org_1',
  connectorSlug: 'imap-smtp',
  authMethod: 'basic',
  name: 'Support inbox',
  encryptedData: { keyFingerprint: 'fp', iv: 'iv', ciphertext: 'ct', tag: 't' },
  endpointUrl: null,
  config: { host: 'imap.door.test' },
  maskedPreview: 'in***@door.test',
  isDefault: true,
  mailSyncInboundSince: null,
  mailSyncOutboundSince: null,
  status: 'active',
  statusDetail: null,
  createdBy: 'user_1',
  createdAt: 1,
  updatedAt: 1,
};

describe('resolveCredentialRowForShim', () => {
  it('answers the full 0.4 row — envelope included, nulls absent', async () => {
    const answer = await resolveCredentialRowForShim(fakeSql([ROW]), {
      organizationId: 'org_1',
      connectorSlug: 'imap-smtp',
    });
    expect(answer).toEqual({
      _id: 'cred_1',
      organizationId: 'org_1',
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'Support inbox',
      encryptedData: ROW.encryptedData,
      config: { host: 'imap.door.test' },
      status: 'active',
    });
    expect(answer).not.toHaveProperty('endpointUrl');
    expect(answer).not.toHaveProperty('statusDetail');
  });

  it('resolves an explicit ref by id or by name, and null on a miss', async () => {
    const sql = fakeSql([ROW]);
    expect(
      await resolveCredentialRowForShim(sql, {
        organizationId: 'org_1',
        connectorSlug: 'imap-smtp',
        credentialRef: 'support INBOX',
      }),
    ).toMatchObject({ _id: 'cred_1' });
    expect(
      await resolveCredentialRowForShim(sql, {
        organizationId: 'org_1',
        connectorSlug: 'imap-smtp',
        credentialRef: 'no-such-credential',
      }),
    ).toBeNull();
    expect(
      await resolveCredentialRowForShim(fakeSql([]), {
        organizationId: 'org_1',
        connectorSlug: 'imap-smtp',
      }),
    ).toBeNull();
  });

  it('hands a disabled row back for the reused resolver to refuse on status', async () => {
    const answer = await resolveCredentialRowForShim(
      fakeSql([{ ...ROW, status: 'disabled', statusDetail: 'operator' }]),
      { organizationId: 'org_1', connectorSlug: 'imap-smtp' },
    );
    expect(answer).toMatchObject({
      status: 'disabled',
      statusDetail: 'operator',
    });
  });
});
