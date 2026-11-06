import type { BrowserOptions } from '@sentry/browser';

type Transport = ReturnType<NonNullable<BrowserOptions['transport']>>;
type Envelope = Parameters<Transport['send']>[0];
import { afterEach, describe, expect, it } from 'vitest';

import { initBrowserMonitoring, reportBrowserError } from './browser';
import { MONITORING_CONFIG_ID } from './config';

function config(text: string): void {
  const script = document.createElement('script');
  script.id = MONITORING_CONFIG_ID;
  script.type = 'application/json';
  script.textContent = text;
  document.head.append(script);
}

afterEach(() => document.getElementById(MONITORING_CONFIG_ID)?.remove());

describe('browser reporting', () => {
  it('is a no-op with missing or malformed runtime metadata', () => {
    expect(initBrowserMonitoring()).toBeUndefined();
    expect(() => reportBrowserError(new Error('not sent'))).not.toThrow();
    config('malformed');
    expect(initBrowserMonitoring()).toBeUndefined();
    document.getElementById(MONITORING_CONFIG_ID)!.textContent = '{}';
    expect(initBrowserMonitoring()).toBeUndefined();
  });

  it('uses the actual SDK and redacts the outgoing envelope', async () => {
    const envelopes: Envelope[] = [];
    const transport: Transport = {
      send: (envelope) => {
        envelopes.push(envelope);
        return Promise.resolve({ statusCode: 200 });
      },
      flush: () => Promise.resolve(true),
    };
    config(
      JSON.stringify({
        dsn: 'https://key@errors.example/42',
        service: 'tale-docs',
        release: 'test-release',
      }),
    );
    const client = initBrowserMonitoring(() => transport);
    expect(client).toBeDefined();
    expect(initBrowserMonitoring()).toBe(client);
    reportBrowserError(new Error('PRIVATE_SEARCH_QUERY'));
    await client?.flush(1000);
    expect(envelopes).toHaveLength(1);
    const wire = JSON.stringify(envelopes);
    expect(wire).toContain('tale-docs');
    expect(wire).toContain('test-release');
    expect(wire).toContain('Application error (details omitted)');
    expect(wire).not.toContain('PRIVATE_SEARCH_QUERY');
    const options = client?.getOptions();
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.sendClientReports).toBe(false);
    expect(options?.enableLogs).toBe(false);
    expect(options?.tracePropagationTargets).toEqual([]);
    expect(client?.getIntegrationByName('BrowserTracing')).toBeUndefined();
    expect(client?.getIntegrationByName('Replay')).toBeUndefined();
    await client?.close();
  });
});
