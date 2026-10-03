import assert from 'node:assert/strict';

import * as Sentry from '@sentry/node';

/** In-memory transport keeps benchmarking separate from live telemetry. */
export async function prepareTelemetryWorkload(enabled: boolean) {
  const {
    configureBackendTracing,
    traceBackendTask,
    traceWorkerPhase,
    scrubTransaction,
  } = await import('../backend/tracing.ts');
  const { httpRequests, httpDuration, methodClass, routeClass } =
    await import('../backend/telemetry.ts');
  let envelopes = 0;
  let transactions = 0;
  if (enabled)
    Sentry.init({
      dsn: 'https://public@performance.invalid/1',
      defaultIntegrations: false,
      tracesSampleRate: 1,
      beforeSendTransaction: scrubTransaction,
      transport: () => ({
        send: async (envelope) => {
          envelopes++;
          for (const [header] of envelope[1])
            if (header.type === 'transaction') transactions++;
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
  configureBackendTracing(enabled);
  return {
    operations: 1000,
    unit: 'tasks',
    description: `1000 bounded metric observations and queue/handler spans, tracing ${enabled ? 'enabled at 100% sampling with in-memory transport' : 'disabled'}; network/automatic HTTP integrations excluded`,
    async run() {
      const before = transactions;
      for (let i = 0; i < 1000; i++) {
        assert.equal(
          traceBackendTask('noop', () => traceWorkerPhase('handler', () => 1)),
          1,
        );
        const labels = {
          method: methodClass('GET'),
          route: routeClass(`/api/app/unknown-${i}`),
        };
        httpRequests.inc({ ...labels, status: '2xx' });
        httpDuration.observe(labels, 0.001);
      }
      if (enabled) assert.equal(await Sentry.flush(10000), true);
      assert.equal(transactions - before, enabled ? 1000 : 0);
    },
    details: () => ({
      exportedEnvelopes: envelopes,
      exportedTransactions: transactions,
    }),
    async cleanup() {
      configureBackendTracing(false);
      httpRequests.reset();
      httpDuration.reset();
      if (enabled) await Sentry.close(10000);
    },
  };
}
