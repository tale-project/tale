/**
 * The composition root: environment in, a running gateway out.
 *
 * Both hosts use it — the production Bun server and the Vite dev server's
 * middleware — so the panel talks to exactly the same API in development as
 * in production, and there is one place where configuration becomes objects.
 */

import { createAccountService, type AccountService } from './accounts';
import {
  loadConfig,
  reportGeneratedSecrets,
  type GatewayConfig,
} from './config';
import { createTokenCipher } from './crypto';
import { createProviderRegistry } from './providers/index';
import { createApi, createApiDispatcher, type Api } from './routes';
import { createFileAccountStore } from './store';

export interface CreateGatewayOptions {
  env?: Record<string, string | undefined>;
  /** Development only — see `loadConfig`. */
  generateMissingSecrets?: boolean;
}

export interface Gateway {
  config: GatewayConfig;
  accounts: AccountService;
  api: Api;
  /** `(request, url) => Response | null`, for a host's route hook. */
  dispatch: (request: Request, url: URL) => Promise<Response> | null;
  /** Start the background refresh; returns the function that stops it. */
  startRefreshLoop: () => () => void;
}

export function createGateway(options: CreateGatewayOptions = {}): Gateway {
  const { config, generated } = loadConfig(options.env, {
    generateMissingSecrets: options.generateMissingSecrets,
  });
  reportGeneratedSecrets(generated);

  const providers = createProviderRegistry({
    anthropicClientId: config.anthropicClientId,
    openAiClientId: config.openAiClientId,
    claudeCodeVersion: config.claudeCodeVersion,
  });

  const accounts = createAccountService({
    store: createFileAccountStore({ dataDir: config.dataDir }),
    providers,
    cipher: createTokenCipher(config.encryptionKey),
    tokenRefreshSkewSeconds: config.tokenRefreshSkewSeconds,
    usageMinIntervalSeconds: config.usageMinIntervalSeconds,
  });

  const api = createApi({ accounts, providers, apiKey: config.apiKey });

  return {
    config,
    accounts,
    api,
    dispatch: createApiDispatcher(api),

    startRefreshLoop() {
      let running = false;
      const pass = () => {
        // Skip rather than overlap: a pass that outruns the interval (many
        // accounts, a slow vendor) would otherwise stack up refreshes of the
        // same rows and spend the per-token rate budget twice over.
        if (running) return;
        running = true;
        void accounts
          .refreshAll()
          .catch((error: unknown) => {
            console.error(
              '[ai-gateway] background refresh pass failed:',
              error,
            );
          })
          .finally(() => {
            running = false;
          });
      };

      pass();
      const timer = setInterval(pass, config.refreshIntervalSeconds * 1000);
      // The loop keeps credentials valid; it must not keep the process alive.
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
