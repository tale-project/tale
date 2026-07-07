import { describe, expect, test } from 'vitest';

import { formsHealthCheck, webHealthStatus } from './health';

describe('formsHealthCheck', () => {
  test('ok when webhook is set', () => {
    expect(formsHealthCheck('https://discord.com/api/webhooks/x/y')).toEqual({
      ok: true,
    });
  });

  test('fails when webhook is empty', () => {
    expect(formsHealthCheck('')).toEqual({
      ok: false,
      error: 'WEB_DISCORD_WEBHOOK_URL unset',
    });
  });
});

describe('webHealthStatus', () => {
  test('returns 200 with checks when forms are optional', () => {
    const result = webHealthStatus({
      webhookUrl: '',
      formsRequired: false,
      version: '1.0.0',
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      version: '1.0.0',
      checks: { forms: { ok: false, error: 'WEB_DISCORD_WEBHOOK_URL unset' } },
    });
  });

  test('returns 503 when forms are required but webhook is unset', () => {
    const result = webHealthStatus({
      webhookUrl: '',
      formsRequired: true,
      version: '1.0.0',
    });
    expect(result.status).toBe(503);
    expect(result.body.status).toBe('degraded');
  });

  test('returns 200 when forms are required and webhook is set', () => {
    const result = webHealthStatus({
      webhookUrl: 'https://discord.com/api/webhooks/x/y',
      formsRequired: true,
      version: '1.0.0',
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
    expect(result.body.checks).toEqual({ forms: { ok: true } });
  });
});
