type HealthCheck = { ok: boolean; error?: string };

export function formsHealthCheck(webhookUrl: string): HealthCheck {
  if (webhookUrl) return { ok: true };
  return { ok: false, error: 'WEB_DISCORD_WEBHOOK_URL unset' };
}

export function webHealthStatus(opts: {
  webhookUrl: string;
  formsRequired: boolean;
  version: string;
}): { status: number; body: Record<string, unknown> } {
  const checks = { forms: formsHealthCheck(opts.webhookUrl) };
  const formsBlocking = opts.formsRequired && !checks.forms.ok;
  return {
    status: formsBlocking ? 503 : 200,
    body: {
      status: formsBlocking ? 'degraded' : 'ok',
      version: opts.version,
      checks,
    },
  };
}
