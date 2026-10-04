import type {
  SandboxDeviceJoinToken,
  SandboxDeviceJoinTokenStatus,
  SandboxDevicesView,
} from '@/lib/shared/schemas/sandbox-devices';

/**
 * `sandbox_devices` — the wire contract for the Devices section of Settings >
 * Sandboxes: the machines an organization connected with `tale sandbox
 * connect`, the one-line command that adds another, and removing one. Served
 * by the adapter rows in `../settings.ts` over `/api/app/sandbox-devices`.
 */

export interface SandboxDevicesContract {
  'sandbox_devices/queries:joinTokenStatus': {
    kind: 'query';
    args: { organizationId: string; tokenId: string };
    returns: SandboxDeviceJoinTokenStatus;
  };
  'sandbox_devices/queries:list': {
    kind: 'query';
    args: { organizationId: string };
    returns: SandboxDevicesView;
  };
  'sandbox_devices/mutations:createJoinToken': {
    kind: 'mutation';
    args: { organizationId: string };
    /** The join token, exactly once — it is embedded in the copied command. */
    returns: SandboxDeviceJoinToken;
  };
  'sandbox_devices/mutations:remove': {
    kind: 'mutation';
    args: { organizationId: string; deviceId: string };
    returns: null;
  };
}
