import { initI18n } from './init';
import { collectRegionalBundles } from './regional-bundles';

type Bundle = Record<string, Record<string, unknown>>;

/**
 * Translation bundles shipped by a frontend package (`@tale/ui`,
 * `@tale/webui`, …). Mirrors the shape the host service uses for its
 * own translations: per-locale namespace trees plus an optional
 * cross-locale `global` for keys that read the same in every language
 * (e.g. `languageSwitcher.locales.*` — the language names display in
 * their own native form).
 */
export interface PackageMessages {
  /**
   * One entry per locale (`en`, `de`, `fr`, plus optional `xx-YY`
   * regional codes). Each entry is a namespace → keys tree.
   */
  bundles: Record<string, Bundle>;
  /**
   * Cross-locale keys merged into every base locale. The
   * convention here matches `services/<x>/messages/global.json`.
   */
  global?: Bundle;
}

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
  /**
   * Per-package bundles to merge in *before* the service's own bundles, so
   * any service-level key wins on conflict. Each entry is what a package
   * exports from `@tale/<name>/i18n/messages`. Package namespaces should
   * be scoped to the component family (`piiPlayground`,
   * `languageSwitcher`, …) so they don't collide with service strings.
   */
  packages?: ReadonlyArray<PackageMessages>;
}

/** Shallow merge at the namespace level — later entries win per namespace. */
function mergeBundles(...bundles: ReadonlyArray<Bundle | undefined>): Bundle {
  const out: Bundle = {};
  for (const b of bundles) {
    if (!b) continue;
    for (const [ns, value] of Object.entries(b)) {
      out[ns] = { ...out[ns], ...value };
    }
  }
  return out;
}

function packageBundle(
  packages: ReadonlyArray<PackageMessages>,
  locale: string,
): Bundle | undefined {
  return mergeBundles(...packages.map((p) => p.bundles[locale]));
}

/**
 * Thin wrapper over `initI18n` + `collectRegionalBundles` that captures the
 * `services/<x>/lib/i18n/i18n.ts` boilerplate: load base bundles statically,
 * `import.meta.glob` the regional variants, layer in any package bundles,
 * and initialise. Every service does the same thing — this is the one place
 * it lives.
 */
export function initServiceI18n({
  bundles,
  regional,
  global,
  packages = [],
}: InitServiceParams) {
  const regionalBundles = collectRegionalBundles(regional);

  const merged: {
    en: Bundle;
    de: Bundle;
    fr: Bundle;
  } & Record<string, Bundle | undefined> = {
    en: mergeBundles(packageBundle(packages, 'en'), bundles.en),
    de: mergeBundles(packageBundle(packages, 'de'), bundles.de),
    fr: mergeBundles(packageBundle(packages, 'fr'), bundles.fr),
  };

  // Layer remaining locales (regional overrides shipped by the service,
  // extra base-locales the service registered, or regional bundles a
  // package wants to ship even when the service itself has no override).
  const extras = new Set<string>([
    ...Object.keys(bundles),
    ...Object.keys(regionalBundles),
    ...packages.flatMap((p) => Object.keys(p.bundles)),
  ]);
  extras.delete('en');
  extras.delete('de');
  extras.delete('fr');
  for (const locale of extras) {
    const fromService = bundles[locale] ?? regionalBundles[locale];
    merged[locale] = mergeBundles(packageBundle(packages, locale), fromService);
  }

  // Package globals fold in before the service's own global so any key
  // the service redeclares overrides whatever a package shipped.
  const mergedGlobal = mergeBundles(...packages.map((p) => p.global), global);

  return initI18n({
    bundles: merged,
    global: mergedGlobal,
  });
}
