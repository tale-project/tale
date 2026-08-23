import { afterEach, describe, expect, it } from 'vitest';

import {
  cloudImportOauthMissingEnvNames,
  microsoftCloudImportOauthUrls,
  resolveCloudImportOauthApp,
  resolveCloudImportOauthRedirectUri,
  resolveMicrosoftCloudImportTenantId,
} from './deployment_config';

describe('resolveCloudImportOauthApp', () => {
  const keys = [
    'CLOUD_IMPORT_MICROSOFT_CLIENT_ID',
    'CLOUD_IMPORT_MICROSOFT_CLIENT_SECRET',
    'CLOUD_IMPORT_MICROSOFT_TENANT_ID',
    'AUTH_MICROSOFT_ENTRA_ID_ID',
    'AUTH_MICROSOFT_ENTRA_ID_SECRET',
    'AUTH_MICROSOFT_ENTRA_ID_TENANT_ID',
    'SITE_URL',
    'BASE_PATH',
  ] as const;

  afterEach(() => {
    for (const key of keys) {
      delete process.env[key];
    }
  });

  it('prefers CLOUD_IMPORT_MICROSOFT_* over login env', () => {
    process.env.CLOUD_IMPORT_MICROSOFT_CLIENT_ID = 'cloud-id';
    process.env.CLOUD_IMPORT_MICROSOFT_CLIENT_SECRET = 'cloud-secret';
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = 'auth-id';
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = 'auth-secret';
    expect(resolveCloudImportOauthApp('onedrive')).toEqual({
      clientId: 'cloud-id',
      clientSecret: 'cloud-secret',
    });
  });

  it('falls back to AUTH_MICROSOFT_ENTRA_ID_*', () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = 'auth-id';
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = 'auth-secret';
    expect(resolveCloudImportOauthApp('onedrive')).toEqual({
      clientId: 'auth-id',
      clientSecret: 'auth-secret',
    });
  });

  it('returns null when nothing is configured', () => {
    expect(resolveCloudImportOauthApp('onedrive')).toBeNull();
    expect(cloudImportOauthMissingEnvNames('onedrive')).toContain(
      'CLOUD_IMPORT_MICROSOFT',
    );
  });
});

describe('resolveMicrosoftCloudImportTenantId', () => {
  afterEach(() => {
    delete process.env.CLOUD_IMPORT_MICROSOFT_TENANT_ID;
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
  });

  it('prefers CLOUD_IMPORT_MICROSOFT_TENANT_ID', () => {
    process.env.CLOUD_IMPORT_MICROSOFT_TENANT_ID = 'cloud-tenant';
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = 'auth-tenant';
    expect(resolveMicrosoftCloudImportTenantId()).toBe('cloud-tenant');
  });

  it('falls back to AUTH_MICROSOFT_ENTRA_ID_TENANT_ID', () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = 'auth-tenant';
    expect(resolveMicrosoftCloudImportTenantId()).toBe('auth-tenant');
  });

  it('returns null when unset', () => {
    expect(resolveMicrosoftCloudImportTenantId()).toBeNull();
  });
});

describe('microsoftCloudImportOauthUrls', () => {
  it('builds tenant-specific authorize and token URLs', () => {
    expect(microsoftCloudImportOauthUrls('tid-123')).toEqual({
      authorizeUrl:
        'https://login.microsoftonline.com/tid-123/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/tid-123/oauth2/v2.0/token',
    });
  });
});

describe('resolveCloudImportOauthRedirectUri', () => {
  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.BASE_PATH;
  });

  it('builds the fixed callback from SITE_URL', () => {
    process.env.SITE_URL = 'https://tale.example';
    expect(resolveCloudImportOauthRedirectUri()).toBe(
      'https://tale.example/api/cloud-import/oauth2/callback',
    );
  });

  it('returns null when SITE_URL is unset', () => {
    expect(resolveCloudImportOauthRedirectUri()).toBeNull();
  });
});
