import { initI18n } from './init';
import { collectRegionalBundles } from './regional-bundles';

type Bundle = Record<string, Record<string, unknown>>;

interface InitServiceParams {
  /** Base-locale bundles (`en`, `de`, `fr`) loaded statically by the service. */
  bundles: {
    en: Bundle;
    de: Bundle;
    fr: Bundle;
  } & Record<string, Bundle | undefined>;
  /**
   * Result of `import.meta.glob('…/messages/*-*.json', { eager: true, import: 'default' })`.
   * Vite requires the glob pattern to be a literal at the call site, so each
   * service evaluates it locally and passes the result here.
   */
  regional: Record<string, Bundle>;
  /** Cross-namespace global keys (typically `services/<x>/messages/global.json`). */
  global?: Bundle;
}

/**
 * Thin wrapper over `initI18n` + `collectRegionalBundles` that captures the
 * `services/<x>/lib/i18n/i18n.ts` boilerplate: load base bundles statically,
 * `import.meta.glob` the regional variants, merge, and initialise. Every
 * service does the same thing — this is the one place it lives.
 */
export function initServiceI18n({
  bundles,
  regional,
  global,
}: InitServiceParams) {
  return initI18n({
    bundles: { ...bundles, ...collectRegionalBundles(regional) },
    global,
  });
}
