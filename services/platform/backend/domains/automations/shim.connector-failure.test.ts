// @vitest-environment node

/**
 * Unit lock for the automation shim's two connector seams: a coded connector
 * refusal reaches the stepper as a `NodeFailure` carrying its sentence and
 * hint (it used to be an `AppError`, whose message is the JSON of its data,
 * so the run detail printed a raw `{"code":…}` blob), and the credential
 * probe answers the dispatcher's own prose for a connector the organization
 * has no usable credential for — and never asks for one on a platform
 * connector (2026-09-26 evaluation, D-09).
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { ConnectorError } from '../../../lib/connectors/errors.ts';
import { NodeFailure } from '../../core/automations/failure.ts';

const {
  runConnectorAction,
  resolveConnectorCredential,
  assertConnectorCredentialInService,
} = vi.hoisted(() => ({
  runConnectorAction: vi.fn(),
  resolveConnectorCredential: vi.fn(),
  assertConnectorCredentialInService: vi.fn(),
}));

vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../connector_credentials/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../connector_credentials/service.ts')
    >();
  return {
    ...actual,
    resolveConnectorCredential,
    assertConnectorCredentialInService,
  };
});
vi.mock('../../../lib/connectors/catalog.ts', () => ({
  loadConnectorDefinitions: () => [
    { name: 'task', auth: [{ method: 'platform' }] },
    { name: 'imap-smtp', auth: [{ method: 'basic' }] },
    { name: 'http', auth: [{ method: 'bearer' }], credential: 'optional' },
  ],
}));

import { ConnectorCredentialError } from '../connector_credentials/service.ts';
import { automationShimHandlers, probeCredentialUsable } from './shim.ts';

const sql = {} as unknown as Sql;
const handlers = automationShimHandlers(sql);

describe('the connector action seam', () => {
  it('rethrows a coded refusal as a connector_error NodeFailure with its hint', async () => {
    runConnectorAction.mockRejectedValueOnce(
      new ConnectorError(
        'CREDENTIAL_UNRESOLVED',
        'no usable credential for imap-smtp: No default credential is configured for "imap-smtp"',
        {
          connector: 'imap-smtp',
          action: 'send',
          hint: 'connect the connector, or mark one of its credentials as the default',
        },
      ),
    );
    const handler = handlers['connectors/execute_action:runConnectorAction'];
    if (!handler) throw new Error('no connector handler');
    const caught = await handler({
      connector: 'imap-smtp',
      action: 'send',
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(NodeFailure);
    const failure = caught as NodeFailure;
    expect(failure.code).toBe('connector_error');
    expect(failure.message).toBe(
      'no usable credential for imap-smtp: No default credential is configured for "imap-smtp"',
    );
    expect(failure.hint).toBe(
      'connect the connector, or mark one of its credentials as the default',
    );
    expect(failure.message).not.toContain('{"code"');
  });

  it('keeps the reason a connector gave for its refusal', async () => {
    const refusal = Object.assign(
      new ConnectorError('LIVE_BODY_FAILED', 'The service answered 404', {
        connector: 'http',
        action: 'get',
      }),
      {
        failure: {
          reason: 'HTTP_STATUS' as const,
          params: { status: 404, method: 'GET', host: 'api.example.com' },
        },
      },
    );
    runConnectorAction.mockRejectedValueOnce(refusal);
    const handler = handlers['connectors/execute_action:runConnectorAction'];
    if (!handler) throw new Error('no connector handler');
    const caught = await handler({ connector: 'http', action: 'get' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(NodeFailure);
    expect((caught as NodeFailure).failure).toEqual(refusal.failure);
  });

  it('lets any other failure through untouched', async () => {
    runConnectorAction.mockRejectedValueOnce(new Error('connection reset'));
    const handler = handlers['connectors/execute_action:runConnectorAction'];
    if (!handler) throw new Error('no connector handler');
    await expect(handler({})).rejects.toThrow('connection reset');
  });
});

describe('the credential probe', () => {
  it('answers usable without a lookup for a step that names no credential where none is needed', async () => {
    await expect(
      probeCredentialUsable(sql, {
        organizationId: 'org_1',
        connectorSlug: 'http',
      }),
    ).resolves.toEqual({ usable: true });
    expect(assertConnectorCredentialInService).not.toHaveBeenCalled();
  });

  it('checks the credential a step names', async () => {
    assertConnectorCredentialInService.mockResolvedValueOnce(undefined);
    await expect(
      probeCredentialUsable(sql, {
        organizationId: 'org_1',
        connectorSlug: 'http',
        credentialRef: 'Shop API',
      }),
    ).resolves.toEqual({ usable: true });
    expect(assertConnectorCredentialInService).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      connectorSlug: 'http',
      credentialRef: 'Shop API',
    });
  });

  it('answers usable without a lookup for a platform connector', async () => {
    await expect(
      probeCredentialUsable(sql, {
        organizationId: 'org_1',
        connectorSlug: 'task',
      }),
    ).resolves.toEqual({ usable: true });
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
  });

  it('answers the dispatcher prose when no credential is in service', async () => {
    assertConnectorCredentialInService.mockRejectedValueOnce(
      new ConnectorCredentialError(
        'CREDENTIAL_NONE_CONFIGURED',
        'No default credential is configured for "imap-smtp" — add one in Settings → Connectors, or name a credential explicitly.',
        404,
      ),
    );
    const handler =
      handlers['connector_credentials/queries:probeCredentialUsableInternal'];
    if (!handler) throw new Error('no probe handler');
    await expect(
      handler({ organizationId: 'org_1', connectorSlug: 'imap-smtp' }),
    ).resolves.toEqual({
      usable: false,
      message:
        'no usable credential for imap-smtp: No default credential is configured for "imap-smtp" — add one in Settings → Connectors, or name a credential explicitly.',
      hint: 'connect the connector, or mark one of its credentials as the default',
    });
    expect(assertConnectorCredentialInService).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      connectorSlug: 'imap-smtp',
    });
  });

  // The probe re-runs on every wake while a run waits at the gate: it reads
  // the row's status only and never resolves (decrypts, refreshes) the
  // credential — a grant expiring meanwhile is the dispatch's to renew.
  it('answers usable from the row alone, never resolving the credential', async () => {
    assertConnectorCredentialInService.mockResolvedValueOnce(undefined);
    await expect(
      probeCredentialUsable(sql, {
        organizationId: 'org_1',
        connectorSlug: 'imap-smtp',
      }),
    ).resolves.toEqual({ usable: true });
    expect(resolveConnectorCredential).not.toHaveBeenCalled();
  });

  it('cannot tell on a failure that is not about the credential, so the approval proceeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertConnectorCredentialInService.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(
      probeCredentialUsable(sql, {
        organizationId: 'org_1',
        connectorSlug: 'imap-smtp',
      }),
    ).resolves.toEqual({ usable: 'unknown', reason: 'db down' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not tell (db down)'),
    );
    warn.mockRestore();
  });
});
