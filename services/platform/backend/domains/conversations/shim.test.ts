/**
 * A heal that says it healed must have written. The sync's IMAP fromAddress
 * heal patches credential `config` through `patchCredentialInternal`; the shim
 * used to `.loose()`-parse the call and forward only the two watermark fields,
 * so `config` was silently dropped — the mirror never landed and the drift was
 * re-detected (and "mirrored" re-logged) on every pass.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  patchMailSyncWatermarks,
  patchCredentialConfigInternal,
  resolveCredentialRowForShim,
} = vi.hoisted(() => ({
  patchMailSyncWatermarks: vi.fn(async () => undefined),
  patchCredentialConfigInternal: vi.fn(async () => undefined),
  resolveCredentialRowForShim: vi.fn(async () => null),
}));

vi.mock('../connector_credentials/service.ts', () => ({
  listActiveCredentials: vi.fn(),
  patchMailSyncWatermarks,
  patchCredentialConfigInternal,
  resolveCredentialRowForShim,
}));
vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
}));

import { conversationShimHandlers } from './shim.ts';

const SQL = {} as never;
const patch = () => {
  const handler = conversationShimHandlers(SQL, () => {
    throw new Error('no connector calls in this test');
  })['connector_credentials/mutations:patchCredentialInternal'];
  if (!handler) throw new Error('handler missing');
  return handler;
};

describe('resolveCredentialRefInternal shim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serves the shared full-row answer the reused resolver decrypts (not an identity-only stub)', async () => {
    const row = {
      _id: 'cred_1',
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'Support inbox',
      encryptedData: { keyFingerprint: 'fp' },
      config: { host: 'imap.door.test' },
      status: 'active',
    };
    resolveCredentialRowForShim.mockResolvedValueOnce(row as never);
    const handler = conversationShimHandlers(SQL, () => {
      throw new Error('no connector calls in this test');
    })['connector_credentials/queries:resolveCredentialRefInternal'];
    if (!handler) throw new Error('handler missing');
    const answer = await handler({
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      credentialRef: 'cred_1',
    });
    expect(resolveCredentialRowForShim).toHaveBeenCalledWith(SQL, {
      organizationId: 'o1',
      connectorSlug: 'imap-smtp',
      credentialRef: 'cred_1',
    });
    expect(answer).toBe(row);
  });
});

describe('patchCredentialInternal shim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a config heal (the IMAP fromAddress mirror)', async () => {
    const config = { host: 'imap.door.test', fromAddress: 'inbox@door.test' };
    await patch()({ organizationId: 'o1', credentialId: 'cred_1', config });
    expect(patchCredentialConfigInternal).toHaveBeenCalledWith(
      SQL,
      'o1',
      'cred_1',
      config,
    );
    // A pure config heal names no watermark, so none is written.
    expect(patchMailSyncWatermarks).not.toHaveBeenCalled();
  });

  it('advances the watermarks it is handed, touching no config', async () => {
    await patch()({
      organizationId: 'o1',
      credentialId: 'cred_1',
      mailSyncInboundSince: 1_000,
    });
    expect(patchMailSyncWatermarks).toHaveBeenCalledWith(SQL, 'o1', 'cred_1', {
      inboundSince: 1_000,
    });
    expect(patchCredentialConfigInternal).not.toHaveBeenCalled();
  });

  it('lands both when a call names both', async () => {
    await patch()({
      organizationId: 'o1',
      credentialId: 'cred_1',
      mailSyncOutboundSince: 2_000,
      config: { fromAddress: 'inbox@door.test' },
    });
    expect(patchCredentialConfigInternal).toHaveBeenCalledTimes(1);
    expect(patchMailSyncWatermarks).toHaveBeenCalledWith(SQL, 'o1', 'cred_1', {
      outboundSince: 2_000,
    });
  });

  it('refuses a config carrying non-scalar values', async () => {
    await expect(
      patch()({
        organizationId: 'o1',
        credentialId: 'cred_1',
        config: { nested: { not: 'allowed' } },
      }),
    ).rejects.toThrow();
    expect(patchCredentialConfigInternal).not.toHaveBeenCalled();
  });
});
