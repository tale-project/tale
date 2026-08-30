/**
 * `deployment` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../deployment.ts` are what
 * actually serve them.
 */

export interface DeploymentContract {
  'deployment/file_actions:readDeploymentConfig': {
    kind: 'action';
    args: Record<string, never>;
    returns: {
      config: {
        version: 1;
        dataStores?: {
          knowledgePostgres?: {
            host: string;
            port: number;
            database: string;
            user: string;
            sslmode:
              | 'disable'
              | 'prefer'
              | 'require'
              | 'verify-ca'
              | 'verify-full';
          };
          convexStorage?:
            | { mode: 'local' }
            | {
                mode: 's3';
                region: string;
                forcePathStyle: boolean;
                buckets: {
                  files: string;
                  exports: string;
                  snapshotImports: string;
                  modules: string;
                  search: string;
                };
                endpoint?: string;
              };
          appPostgres?: {
            host: string;
            port: number;
            database: string;
            user: string;
            sslmode:
              | 'disable'
              | 'prefer'
              | 'require'
              | 'verify-ca'
              | 'verify-full';
          };
        };
        sandboxRuntime?: {
          tier?: 'runc' | 'gvisor' | 'sysbox' | 'kata';
          dockerInContainer?: boolean;
          dockerBuildCache?: boolean;
        };
      };
      hash: null | string;
      secrets: Record<string, { present: boolean; masked?: string }>;
      secretsError: undefined | 'encrypted_no_key' | 'unreadable';
      canEdit: boolean;
      email: undefined | string;
    };
  };
  'deployment/file_actions:requestRestart': {
    kind: 'action';
    args: { services?: string[] };
    returns:
      | { configured: boolean; ok: boolean; error: string }
      | { configured: boolean; ok: boolean; error?: undefined };
  };
  'deployment/file_actions:saveDeploymentConfig': {
    kind: 'action';
    args: { expectedHash?: string; config: unknown };
    returns: { hash: string };
  };
  'deployment/file_actions:saveDeploymentSecret': {
    kind: 'action';
    args: { force?: boolean; secrets: Record<string, string> };
    returns: null;
  };
  'deployment/file_actions:testDeploymentConnection': {
    kind: 'action';
    args: {
      password?: string;
      config: unknown;
      target: 'knowledgePostgres' | 'convexStorage' | 'appPostgres';
    };
    returns:
      | {
          ok: boolean;
          error: string;
          hint?: undefined;
          latencyMs?: undefined;
          httpStatus?: undefined;
          version?: undefined;
          vectorAvailable?: undefined;
          paradedbAvailable?: undefined;
        }
      | {
          ok: boolean;
          hint: string;
          error?: undefined;
          latencyMs?: undefined;
          httpStatus?: undefined;
          version?: undefined;
          vectorAvailable?: undefined;
          paradedbAvailable?: undefined;
        }
      | {
          ok: boolean;
          latencyMs: number;
          httpStatus: number;
          hint: string;
          error?: undefined;
          version?: undefined;
          vectorAvailable?: undefined;
          paradedbAvailable?: undefined;
        }
      | {
          ok: boolean;
          latencyMs: undefined | number;
          version: undefined | string;
          vectorAvailable: undefined | boolean;
          paradedbAvailable: undefined | boolean;
          error: undefined | string;
          hint: undefined | string;
          httpStatus?: undefined;
        };
  };
}
