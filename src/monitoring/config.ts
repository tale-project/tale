/** Public metadata only: never serialize arbitrary process environment values. */
export interface SiteMonitoringConfig {
  dsn: string;
  service: string;
  release?: string;
  environment?: string;
}

export const MONITORING_CONFIG_ID = 'tale-monitoring';

/** Invalid or insecure remote configuration leaves reporting disabled. */
export function monitoringConfig(
  input: unknown,
): SiteMonitoringConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (!('dsn' in input) || typeof input.dsn !== 'string' || !input.dsn)
    return undefined;
  if (!('service' in input) || typeof input.service !== 'string')
    return undefined;
  try {
    const url = new URL(input.dsn);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      return undefined;
    if (
      !url.username ||
      url.password ||
      !/\/\d+$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      return undefined;
    return {
      dsn: input.dsn,
      service: input.service,
      ...('release' in input && typeof input.release === 'string'
        ? { release: input.release }
        : {}),
      ...('environment' in input && typeof input.environment === 'string'
        ? { environment: input.environment }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/** An inert JSON script must not allow a value to close its HTML element. */
export function monitoringJson(config: SiteMonitoringConfig): string {
  return JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
