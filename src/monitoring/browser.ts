import {
  dedupeIntegration,
  globalHandlersIntegration,
  init,
  type BrowserOptions,
} from '@sentry/browser';

import { monitoringConfig, MONITORING_CONFIG_ID } from './config';
import { redactSiteError } from './redact';

let client: ReturnType<typeof init>;

/** The server supplies runtime JSON before this module runs; no extra fetch. */
export function initBrowserMonitoring(
  transport?: BrowserOptions['transport'],
): ReturnType<typeof init> {
  if (client || typeof document === 'undefined') return client;
  const text = document.getElementById(MONITORING_CONFIG_ID)?.textContent;
  if (!text) return undefined;
  let config;
  try {
    config = monitoringConfig(JSON.parse(text));
  } catch {
    return undefined;
  }
  if (!config) return undefined;
  client = init({
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    ...(transport ? { transport } : {}),
    defaultIntegrations: false,
    integrations: [globalHandlersIntegration(), dedupeIntegration()],
    sendDefaultPii: false,
    sendClientReports: false,
    enableLogs: false,
    tracePropagationTargets: [],
    beforeSend: (event) => redactSiteError(event, config.service, true),
  });
  return client;
}

/** Router and React boundaries handle errors before global listeners see them. */
export function reportBrowserError(error: unknown): void {
  client?.captureException(error);
}
