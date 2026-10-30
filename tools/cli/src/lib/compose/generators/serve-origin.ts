import type { RunOrigin } from '../../config/dev-origin';
import type { ComposeService } from '../types';

/**
 * Serve `origin` from these services instead of `.env`'s HOST and SITE_URL.
 *
 * Explicit Compose environment wins over env_file, so auth, callback and blob
 * URLs follow the origin of this run while the stored deployment settings
 * stay intact. Compose interpolation reads `.env`, not the service's own
 * environment, so a value built on `${SITE_URL}` gets the origin written in.
 */
export function serveOrigin(
  services: ComposeService[],
  origin: RunOrigin,
  environment: Record<string, string> = {},
): void {
  for (const service of services) {
    const inherited = Object.fromEntries(
      Object.entries(service.environment ?? {}).map(([key, value]) => [
        key,
        value.replaceAll('${SITE_URL}', origin.siteUrl),
      ]),
    );
    service.environment = {
      ...inherited,
      HOST: origin.host,
      SITE_URL: origin.siteUrl,
      ...environment,
    };
  }
}
