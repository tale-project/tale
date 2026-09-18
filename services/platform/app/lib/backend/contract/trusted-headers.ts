import type {
  TrustedHeaderAssertableRole,
  TrustedHeaderKeyCreated,
  TrustedHeadersView,
} from '@/lib/shared/schemas/trusted_headers';

/**
 * `trusted_headers` — the wire contract for the settings card behind
 * Settings > Enterprise SSO > Trusted headers: the organization's switch,
 * role ceiling and keys. Served by the adapter rows in `../admin.ts` over
 * `/api/app/trusted-headers`.
 */

export interface TrustedHeadersContract {
  'trusted_headers/queries:get': {
    kind: 'query';
    args: { organizationId: string };
    returns: TrustedHeadersView;
  };
  'trusted_headers/mutations:setSettings': {
    kind: 'mutation';
    args: {
      organizationId: string;
      enabled: boolean;
      maxAssertedRole: TrustedHeaderAssertableRole;
    };
    returns: TrustedHeadersView;
  };
  'trusted_headers/mutations:createKey': {
    kind: 'mutation';
    args: { organizationId: string; name: string };
    /** The plaintext, exactly once. */
    returns: TrustedHeaderKeyCreated;
  };
  'trusted_headers/mutations:revokeKey': {
    kind: 'mutation';
    args: { organizationId: string; keyId: string };
    returns: null;
  };
}
