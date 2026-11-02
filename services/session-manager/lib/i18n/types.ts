// The catalogs are YAML imports, one file per topic and locale
// (`messages/<locale>/<topic>.yml`, a topic being one top-level namespace),
// parsed by the shared vite plugin in bundled surfaces and natively by Bun
// elsewhere, so their module type is loose. Key correctness is enforced by the
// i18n test gates (parity, orphan, and missing-key checks), not by the type
// system. The namespaces a component may read are listed here, and a
// component names its namespace literally (`useT('sessions')`).
export type Namespace =
  | 'banners'
  | 'common'
  | 'errors'
  | 'navigation'
  | 'proxies'
  | 'secrets'
  | 'sessions'
  | 'settings'
  | 'viewer';
