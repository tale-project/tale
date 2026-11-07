import {
  init,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
} from '@sentry/bun';

import { monitoringConfig, type SiteMonitoringConfig } from './config';
import { redactSiteError } from './redact';

let client: ReturnType<typeof init>;

export interface SiteErrorReporting {
  config: SiteMonitoringConfig | undefined;
  capture: (error: unknown) => void;
  flush: () => Promise<void>;
}

/** Missing DSN initializes no SDK, instrumentation, sessions or listeners. */
export function initServerMonitoring(input: unknown): SiteErrorReporting {
  const config = monitoringConfig(input);
  if (config && !client) {
    client = init({
      dsn: config.dsn,
      release: config.release,
      environment: config.environment,
      defaultIntegrations: false,
      integrations: [
        onUncaughtExceptionIntegration(),
        onUnhandledRejectionIntegration({ mode: 'strict' }),
      ],
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      sendClientReports: false,
      enableLogs: false,
      tracePropagationTargets: [],
      beforeSend: (event) => redactSiteError(event, config.service, false),
    });
  }
  return {
    config,
    capture(error) {
      if (config) client?.captureException(error);
    },
    async flush() {
      if (config) await client?.flush(2000);
    },
  };
}
